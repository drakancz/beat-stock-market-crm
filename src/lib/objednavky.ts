import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prepocitejOdmenu, zapisDoporuceni } from "@/lib/doporuceni";
import { stitekPoZaplaceni } from "@/lib/pravidla";
import { sDph } from "@/lib/dph";
import { OBCHODNI_PODMINKY_OD } from "@/lib/klient/obchodni-podminky";
import { MAX_BROKERU, prijmiLead } from "@/lib/leady";
import { opisDelkuPlatnosti, prepocitejPlatnost } from "@/lib/platnost";
import { spocitejSlevu, type VysledekSlevy } from "@/lib/slevove-kody";
import { dataObjednavky, posliWebhook } from "@/lib/webhooky";
import { odkazNaPlatbu as odkazPlatby } from "@/lib/platby/platby";
import { udajeKPrevodu, type UdajeKPrevodu } from "@/lib/platby/prevod";
import { poZaplaceni } from "@/lib/zaplaceni";
import { fakturacniSchema, sloupceFakturace } from "@/lib/fakturacni-udaje";
import type { OrderChannel } from "@/generated/prisma/enums";

/**
 * Příjem objednávek z Landing Page (`POST /api/objednavky`, Jakub,
 * 22. 9. 2026).
 *
 * Tudy se do CRM dostávají objednávky — v rozhraní je nikdo nezakládá.
 * Celá logika je tady, ne v obsluze adresy; ta jen ověří klíč a předá
 * data dál. Stejné rozdělení jako u příjmu leadů.
 *
 * Pravidla, na kterých to stojí:
 *
 * 1. **Co přijde zvenčí, je vždy podezřelé** (security_warnings.md,
 *    pravidlo 11). Každé pole má typ, délku i tvar; nic se nepředává do
 *    databáze tak, jak dorazilo.
 * 2. **Cena se nepřebírá z požadavku, bere se z ceníku.** Kdyby cenu
 *    posílala Landing Page, dal by se podvrženým požadavkem koupit kurz
 *    za korunu. Přijímá se jen to, **co** si klient objednal a kolik
 *    kusů; kolik to stojí, ví CRM samo.
 * 3. **Klienta zakládá tentýž kód jako u leadů** (`prijmiLead()`) —
 *    včetně přiřazení obchodníka, poznámky a odeslání do SmartEmailingu
 *    se souhlasem. Objednávka od člověka, kterého ještě neznáme, ho tedy
 *    rovnou založí jako klienta.
 * 4. **Objednávka vrátí klienta ze Smazaných** (Jakub, 23. 9. 2026).
 *    Do té doby se objednávka klienta v koši odmítala a ležela jen
 *    v Chybách — objednávka ale znamená peníze a nesmí se ztratit.
 *    Klient se vrátí mezi klienty a do auditu se zapíše
 *    `klient.vracen-objednavkou`.
 * 4a. **Souhlas s marketingem je povinný údaj** (Jakub, 23. 9. 2026).
 *    Zákazník ho na Landing Page zaškrtává (`true`), nebo nechává
 *    prázdný (`false`); objednávka bez něj se odmítne, aby chybějící
 *    zaškrtávátko na webu nezůstalo bez povšimnutí. Zaškrtnutí dá souhlas
 *    i známému klientovi, nezaškrtnutí ho nikomu nebere.
 * 5. **Objednávka přichází ve stavu Nová**, pokud Landing Page neřekne
 *    jinak. Zaplaceno může poslat jen tehdy, když platba opravdu prošla
 *    platební bránou.
 * 6. **Do logu se nedostane obsah objednávky** (pravidlo 8) — jména,
 *    e-maily ani telefony.
 * 7. **Audit má prázdné „kdo"**, stejně jako u leadů: objednávku
 *    nevytvořil člověk z týmu.
 * 8. **Slevový kód** (Fáze 5A, 14. 10. 2026): Landing Page pošle jen kód,
 *    slevu spočítá CRM (`src/lib/slevove-kody.ts`). **Neplatný kód
 *    objednávku odmítne** — ještě před založením klienta, a znovu uvnitř
 *    transakce se zamčeným kódem, ať dvě souběžné objednávky nepřekročí
 *    počet použití.
 */

/** Kód, který uvnitř transakce přestal platit — transakce se vrátí. */
class KodOdmitnut extends Error {}

/** Nejvíc položek v jedné objednávce. Víc by nebyla objednávka, ale útok. */
const MAX_POLOZEK = 30;

/** Nejvíc kusů jednoho produktu. Kurz ani členství se po stovkách nekupují. */
const MAX_KUSU = 99;

const polozkaSchema = z
  .object({
    /** Id produktu z ceníku CRM — nejspolehlivější způsob. */
    id: z.string().trim().max(64).optional(),
    /** Název produktu, když Landing Page id nezná. Musí sedět přesně. */
    nazev: z.string().trim().max(160).optional(),
    name: z.string().trim().max(160).optional(),
    pocet: z.number().int().positive().max(MAX_KUSU).optional(),
    quantity: z.number().int().positive().max(MAX_KUSU).optional(),
  })
  .strict();

const vstupSchema = z
  .object({
    /** Kontakt na klienta — předává se dál do `prijmiLead()`. */
    email: z.string().trim().max(254),
    jmeno: z.string().trim().max(60).optional(),
    firstName: z.string().trim().max(60).optional(),
    prijmeni: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    telefon: z.string().trim().max(32).optional(),
    phone: z.string().trim().max(32).optional(),
    /** Souhlas s marketingem, pokud ho Landing Page sbírá. */
    souhlasMarketing: z.boolean(),

    /**
     * Brokeři, které klient používá — **povinně aspoň jeden, nebo
     * `nemamBrokera: true`** (Jakub, 25. 9. 2026). Klient jich může na
     * Landing Page zaškrtnout víc. **Jen informace**: uloží se ke
     * klientovi, portfolio nevzniká.
     */
    brokeri: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_BROKERU).optional(),
    nemamBrokera: z.boolean().optional(),

    /** Název objednávky. Když nepřijde, poskládá se z objednaných produktů. */
    nazev: z.string().trim().max(160).optional(),

    /**
     * Stav objednávky. **Zaplaceno se smí poslat jen po skutečné platbě**
     * přes platební bránu; CRM to nijak neověřuje.
     */
    stav: z.enum(["NOVA", "NEZAPLACENO", "ZAPLACENO"]).optional(),

    produkty: z.array(polozkaSchema).min(1).max(MAX_POLOZEK),

    /** Slevový kód, který zákazník zadal. Prázdný = bez slevy. */
    slevovyKod: z.string().trim().max(40).optional(),

    /** Fakturační údaje (19. 10. 2026) — nepovinné, přepíšou ty u klienta. */
    fakturacni: fakturacniSchema.optional(),

    /**
     * Zákazník zaškrtl souhlas s obchodními podmínkami (Landing Page,
     * 26. 10. 2026). K objednávce se zapíše aktuální znění
     * (`OBCHODNI_PODMINKY_OD`) jako v klientské části. Nepovinné kvůli
     * starším webům; `false` se nepřijímá — bez souhlasu web neobjednává.
     */
    souhlasPodminky: z.literal(true).optional(),
  })
  .strict();

export type VstupObjednavky = z.infer<typeof vstupSchema>;

export type VysledekObjednavky =
  | {
      ok: true;
      objednavkaId: string;
      cislo: string;
      klientId: string;
      zprava: string;
      /** Jen u objednávky se slevovým kódem — částky s DPH. */
      sleva?: { kod: string; celkemPredSlevou: number; sleva: number; celkem: number };
      /** Adresa platební stránky GoPay — jen u nezaplacené, když je brána zapnutá. */
      odkazNaPlatbu?: string;
      /**
       * Údaje k převodu s QR platbou (krok 1B, 26. 10. 2026) — jen
       * u nezaplacené objednávky z Landing Page a jen s platným číslem účtu
       * v Nastavení → Firma.
       */
      platba?: UdajeKPrevodu;
    }
  | { ok: false; chyba: string };

/** Text bez diakritiky a velkých písmen — na porovnávání názvů produktů. */
function bezDiakritiky(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Přeloží položky z požadavku na produkty z ceníku.
 *
 * **Nenalezený produkt objednávku odmítne**, nezakládá se. Ceník spravuje
 * administrátor a objednávka na neznámý produkt znamená, že Landing Page
 * nabízí něco, co v CRM není — to se má opravit, ne tiše přejít.
 *
 * Neprodávaný produkt (`active: false`) projde: klient si ho mohl
 * objednat chvíli předtím, než ho někdo z nabídky stáhl.
 */
async function najdiProdukty(polozky: z.infer<typeof polozkaSchema>[]) {
  // Smazaný produkt se nenabízí — objednávka na něj je jako na neznámý.
  const produkty = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, currency: true },
  });

  const podleId = new Map(produkty.map((produkt) => [produkt.id, produkt]));
  const podleNazvu = new Map(produkty.map((produkt) => [bezDiakritiky(produkt.name), produkt]));

  // Stejný produkt ve dvou řádcích se sečte — v databázi je na dvojici
  // objednávka + produkt jedinečnost.
  const nalezene = new Map<string, { productId: string; quantity: number; currency: string }>();

  for (const polozka of polozky) {
    const nazev = polozka.nazev ?? polozka.name;
    const produkt = polozka.id
      ? podleId.get(polozka.id)
      : nazev
        ? podleNazvu.get(bezDiakritiky(nazev))
        : undefined;

    if (!produkt) {
      return {
        ok: false as const,
        chyba: "Objednávka obsahuje produkt, který v ceníku CRM není.",
      };
    }

    const pocet = polozka.pocet ?? polozka.quantity ?? 1;
    const stavajici = nalezene.get(produkt.id);

    if (stavajici) {
      stavajici.quantity = Math.min(stavajici.quantity + pocet, MAX_KUSU);
    } else {
      nalezene.set(produkt.id, {
        productId: produkt.id,
        quantity: pocet,
        currency: produkt.currency,
      });
    }
  }

  const radky = [...nalezene.values()];

  // Objednávka má jednu měnu — sloupec v databázi je jeden. Ceník je celý
  // v korunách, takže se to stát nemá; kdyby ano, je to chyba ceníku.
  const meny = new Set(radky.map((radek) => radek.currency));
  if (meny.size > 1) {
    return { ok: false as const, chyba: "Objednané produkty nejsou ve stejné měně." };
  }

  const nazvy = radky.map(
    (radek) => produkty.find((produkt) => produkt.id === radek.productId)!.name,
  );

  return { ok: true as const, radky, mena: [...meny][0]!, nazvy };
}

/** Název objednávky poskládaný z produktů, když ho Landing Page nepošle. */
function nazevZProduktu(nazvy: string[]): string {
  const dohromady = nazvy.join(" + ");
  return dohromady.length <= 160 ? dohromady : `${dohromady.slice(0, 157)}…`;
}

export async function prijmiObjednavku(telo: unknown): Promise<VysledekObjednavky> {
  const vstup = vstupSchema.safeParse(telo);
  if (!vstup.success) {
    // Chybějící souhlas je nejčastější chyba zapojení webu — říct ji přímo.
    const bezSouhlasu = vstup.error.issues.some((chyba) => chyba.path[0] === "souhlasMarketing");
    return {
      ok: false,
      chyba: bezSouhlasu
        ? "Chybí souhlasMarketing (true, nebo false) — zaškrtávátko souhlasu na Landing Page."
        : "Neznámé, chybějící nebo příliš dlouhé pole v požadavku.",
    };
  }

  const data = vstup.data;

  // Broker je u objednávky povinná volba (Jakub, 25. 9. 2026): klient na
  // Landing Page vybere brokera, nebo zaškrtne „Nemám brokera". Obojí
  // najednou je nesmysl.
  const maBrokera = (data.brokeri?.length ?? 0) > 0;
  const nemaBrokera = data.nemamBrokera === true;
  if (maBrokera === nemaBrokera) {
    return {
      ok: false,
      chyba: maBrokera
        ? "Pošli buď brokery (brokeri), nebo nemamBrokera — ne obojí."
        : 'Chybí broker: pošli brokery (brokeri: ["XTB"]), nebo nemamBrokera: true.',
    };
  }

  const produkty = await najdiProdukty(data.produkty);
  if (!produkty.ok) return { ok: false, chyba: produkty.chyba };

  // Kód se ověří dřív, než vznikne klient — odmítnutá objednávka nemá
  // v CRM nechat nového klienta.
  const kodText = data.slevovyKod?.trim() || null;
  if (kodText) {
    const predbezne = await spocitejSlevu(kodText, produkty.radky, { email: data.email });
    if (!predbezne.ok) return { ok: false, chyba: predbezne.chyba };
  }

  /*
   * Klienta zakládá (nebo najde) tentýž kód jako u leadů z webu — včetně
   * odeslání do SmartEmailingu se souhlasem. Objednávkou se tedy
   * z návštěvníka stane klient CRM. `objednavka: true` navíc vrátí
   * klienta ze Smazaných a zaškrtnutý souhlas dá i známému klientovi.
   */
  const lead = await prijmiLead(
    {
      email: data.email,
      jmeno: data.jmeno,
      firstName: data.firstName,
      prijmeni: data.prijmeni,
      lastName: data.lastName,
      telefon: data.telefon,
      phone: data.phone,
      souhlasMarketing: data.souhlasMarketing,
      brokeri: data.brokeri,
      nemamBrokera: data.nemamBrokera,
    },
    { objednavka: true },
  );

  if (!lead.ok) return { ok: false, chyba: lead.chyba };

  const nazev = data.nazev?.trim() || nazevZProduktu(produkty.nazvy);
  const stav = data.stav ?? "NOVA";

  const vysledek = await zapisObjednavku({
    klientId: lead.klientId,
    produkty,
    nazev,
    stav,
    kodText,
    kanal: "LANDING_PAGE",
    fakturacni: data.fakturacni,
    ...(data.souhlasPodminky ? { podminky: OBCHODNI_PODMINKY_OD } : {}),
  });
  if (!vysledek.ok || stav === "ZAPLACENO") return vysledek;

  // Poděkování na webu ukáže převod s QR kódem (krok 1B). Výpadek tady
  // objednávku neshodí — je zapsaná a zaplatit jde i podle faktury.
  try {
    const platba = await udajeKPrevodu(vysledek.objednavkaId);
    return platba ? { ...vysledek, platba } : vysledek;
  } catch (chyba) {
    console.error(
      "Údaje k platbě se nepodařilo připravit:",
      chyba instanceof Error ? chyba.name : "neznámá",
    );
    return vysledek;
  }
}

/**
 * Zápis objednávky ke známému klientovi — společný pro Landing Page
 * a klientskou část (Jakub, 20. 10. 2026), ať se cena, sleva, platnost,
 * odměna, audit i webhook nerozejdou. Ceny vždy z ceníku, slevu počítá
 * `spocitejSlevu()` znovu uvnitř transakce se zamčeným kódem.
 */
async function zapisObjednavku(vstup: {
  klientId: string;
  produkty: Extract<Awaited<ReturnType<typeof najdiProdukty>>, { ok: true }>;
  nazev: string;
  stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO";
  kodText: string | null;
  kanal: OrderChannel;
  fakturacni?: VstupObjednavky["fakturacni"];
  /** Znění obchodních podmínek, se kterým klient souhlasil (klientská část). */
  podminky?: string;
}): Promise<VysledekObjednavky> {
  const { klientId, produkty, nazev, stav, kodText, kanal, podminky } = vstup;

  const vysledek = await db
    .$transaction(async (tx) => {
      let sleva: Extract<VysledekSlevy, { ok: true }> | null = null;
      if (kodText) {
        // Zámek na řádku kódu: souběžná objednávka se stejným kódem počká,
        // až tahle doběhne, a počet použití pak spočítá i s ní.
        await tx.$queryRaw`SELECT 1 FROM "discount_codes" WHERE "code" = ${kodText.toUpperCase()} FOR UPDATE`;
        const overeni = await spocitejSlevu(kodText, produkty.radky, { klientId }, tx);
        if (!overeni.ok) throw new KodOdmitnut(overeni.chyba);
        sleva = overeni;
      }

      // Fakturační údaje z webu (19. 10. 2026) — co přišlo, přepíše dosavadní.
      if (vstup.fakturacni) {
        await tx.client.update({
          where: { id: klientId },
          data: sloupceFakturace(vstup.fakturacni),
        });
      }

      const zalozena = await tx.order.create({
        data: {
          name: nazev,
          clientId: klientId,
          status: stav,
          channel: kanal,
          termsAcceptedAt: podminky ? new Date() : null,
          termsVersion: podminky ?? null,
          // Přístup do programu je od 23. 9. 2026 u klienta a objednávka
          // ho nemění — zařizuje ho člověk, i u zaplacené objednávky.
          currency: produkty.mena,
          paidAt: stav === "ZAPLACENO" ? new Date() : null,
          discountCodeId: sleva?.kod.id ?? null,
          items: {
            create: produkty.radky.map((radek) => {
              // Bez kódu doplní cenu spouštěč `order_items_cena`. S kódem ji
              // zapíšeme sami — po slevě, a ceníkovou vedle ní.
              const cena = sleva?.ceny.get(radek.productId);
              return {
                productId: radek.productId,
                quantity: radek.quantity,
                ...(cena
                  ? {
                      netPrice: cena.netPrice,
                      vatPercent: cena.vatPercent,
                      listNetPrice: cena.zlevneno ? cena.listNetPrice : null,
                    }
                  : {}),
              };
            }),
          },
        },
        select: { id: true, number: true },
      });

      // Kód doporučitele (5A, 15. 10. 2026): nový klient je jeho přivedený.
      if (sleva?.kod.referrerId) {
        await zapisDoporuceni(tx, {
          objednavkaId: zalozena.id,
          klientId,
          doporucitelId: sleva.kod.referrerId,
        });
      }

      // Objednávka zaplacená rovnou přes bránu hned prodlouží platnost
      // členství (Jakub, 24. 9. 2026) — stejně jako ruční přepnutí stavu.
      // Doporučiteli z ní rovnou vznikne odměna.
      if (stav === "ZAPLACENO") {
        await opisDelkuPlatnosti(tx, zalozena.id, true);
        await prepocitejPlatnost(tx, klientId);
        await prepocitejOdmenu(tx, zalozena.id, null);
        // Pravidlo Zaplaceno → štítek (5D, 18. 10. 2026).
        await stitekPoZaplaceni(tx, zalozena.id);
      }

      // „Kdo" je prázdné — objednávku nevytvořil člověk z týmu, ale klient
      // na Landing Page nebo v klientské části. V Aktivitě jako web.
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "orders",
        entityId: zalozena.id,
        action: "objednavka.prijata",
        after: {
          cislo: zalozena.number,
          name: nazev,
          stav,
          polozek: produkty.radky.length,
          zdroj: kanal === "KLIENTSKA_CAST" ? "klientska-cast" : "landing-page",
          ...(sleva ? { slevovyKod: sleva.kod.code, slevaSDph: sleva.sleva } : {}),
          ...(podminky ? { obchodniPodminky: podminky } : {}),
        },
      });

      return { zalozena, sleva };
    })
    .catch((chyba: unknown) => {
      if (chyba instanceof KodOdmitnut) return chyba;
      throw chyba;
    });

  if (vysledek instanceof KodOdmitnut) return { ok: false, chyba: vysledek.message };
  const { zalozena: objednavka, sleva: pouzitaSleva } = vysledek;

  // Zaplacená rovnou přes bránu — klient dostane upozornění (3A,
  // 4. 10. 2026), jen když už má účet v klientské části.
  // Faktura, upozornění a webhook — stejně jako po ručním zaplacení.
  if (stav === "ZAPLACENO") poZaplaceni(objednavka.id);
  // Odchozí webhooky (19. 10. 2026) — bez kontaktů, až po odpovědi.
  posliWebhook("objednavka.nova", () => dataObjednavky(objednavka.id));

  // Platební brána (19. 10. 2026): web klienta hned přesměruje na platbu.
  // Výpadek brány objednávku neshodí — zaplatit jde i později.
  let odkazNaPlatbu: string | null = null;
  if (stav !== "ZAPLACENO") {
    try {
      odkazNaPlatbu = await odkazPlatby(objednavka.id);
    } catch (chyba) {
      console.error(
        "Platbu se nepodařilo založit:",
        chyba instanceof Error ? chyba.name : "neznámá",
      );
    }
  }

  return {
    ok: true,
    objednavkaId: objednavka.id,
    cislo: objednavka.number,
    klientId,
    zprava: `Objednávka ${objednavka.number} je zapsaná.`,
    ...(odkazNaPlatbu ? { odkazNaPlatbu } : {}),
    ...(pouzitaSleva
      ? {
          sleva: {
            kod: pouzitaSleva.kod.code,
            celkemPredSlevou: pouzitaSleva.celkemPredSlevou,
            sleva: pouzitaSleva.sleva,
            celkem: pouzitaSleva.celkemPoSleve,
          },
        }
      : {}),
  };
}

/* ---------- Nákup v klientské části (Jakub, 20. 10. 2026) ---------- */

/**
 * Nejvýš tolik nezaplacených objednávek smí mít klient najednou. Klientská
 * část je za přihlášením, ale dvojklik nebo zapomenutá karta by jinak
 * plnily seznam objednávek, které nikdo nezaplatí.
 */
export const MAX_NEZAPLACENYCH = 3;

/**
 * Klient si v klientské části koupí jeden produkt (prodloužení členství,
 * kurz, konzultaci). Klient je vždy ten přihlášený (`requireKlient()`
 * u volajícího), produkt se hledá v ceníku — jen prodávaný a nesmazaný.
 * Stav Nová; zaplatí převodem, nebo branou, když je zapnutá.
 *
 * Volající už ověřil souhlas s obchodními podmínkami — k objednávce se
 * zapíše aktuální znění (`OBCHODNI_PODMINKY_OD`).
 */
export async function objednejVKlientskeCasti(
  klientId: string,
  productId: string,
  kod: string | null,
): Promise<VysledekObjednavky> {
  const produkt = await db.product.findFirst({
    where: { id: productId, active: true, deletedAt: null },
    select: { id: true },
  });
  if (!produkt) return { ok: false, chyba: "Tenhle produkt teď v nabídce není." };

  const nezaplacenych = await db.order.count({
    where: { clientId: klientId, deletedAt: null, status: { in: ["NOVA", "NEZAPLACENO"] } },
  });
  if (nezaplacenych >= MAX_NEZAPLACENYCH) {
    return {
      ok: false,
      chyba: "Máte několik nezaplacených objednávek. Zaplaťte je prosím, nebo nám napište.",
    };
  }

  const produkty = await najdiProdukty([{ id: produkt.id, pocet: 1 }]);
  if (!produkty.ok) return { ok: false, chyba: produkty.chyba };

  return zapisObjednavku({
    klientId,
    produkty,
    nazev: nazevZProduktu(produkty.nazvy),
    stav: "NOVA",
    kodText: kod?.trim() || null,
    kanal: "KLIENTSKA_CAST",
    podminky: OBCHODNI_PODMINKY_OD,
  });
}

/* ---------- Ověření slevového kódu pro Landing Page ---------- */

const overeniSchema = z
  .object({
    slevovyKod: z.string().trim().min(1).max(40),
    produkty: z.array(polozkaSchema).min(1).max(MAX_POLOZEK),
    /** E-mail zákazníka, pokud ho web už zná — kvůli „jednou na klienta“. */
    email: z.string().trim().max(254).optional(),
  })
  .strict();

export type VysledekOvereni =
  | {
      ok: true;
      platny: true;
      kod: string;
      /** Částky s DPH, jak je uvidí zákazník. */
      celkemPredSlevou: number;
      sleva: number;
      celkem: number;
      polozky: { id: string; nazev: string; pocet: number; cenaPredSlevou: number; cena: number }[];
    }
  | { ok: true; platny: false; duvod: string }
  | { ok: false; chyba: string };

/**
 * `POST /api/objednavky/kod` (Fáze 5A, Jakub 14. 10. 2026) — Landing Page
 * se zeptá, jestli kód platí a kolik ubere, ještě než zákazník objedná.
 * Spočítá se to **stejnou funkcí jako při objednávce**, takže cena na webu
 * a v CRM se nerozejde. Nic se nezapisuje.
 *
 * Neplatný kód není chyba volajícího, ale běžná odpověď (`platny: false`
 * s důvodem pro zákazníka) — a do sekce Chyby se proto nezapisuje.
 */
export async function overSlevovyKod(telo: unknown): Promise<VysledekOvereni> {
  const vstup = overeniSchema.safeParse(telo);
  if (!vstup.success) {
    return { ok: false, chyba: "Neznámé, chybějící nebo příliš dlouhé pole v požadavku." };
  }

  const produkty = await najdiProdukty(vstup.data.produkty);
  if (!produkty.ok) return { ok: false, chyba: produkty.chyba };

  const email = vstup.data.email?.toLowerCase() || null;
  const sleva = await spocitejSlevu(
    vstup.data.slevovyKod,
    produkty.radky,
    email ? { email } : null,
  );
  if (!sleva.ok) return { ok: true, platny: false, duvod: sleva.chyba };

  return {
    ok: true,
    platny: true,
    kod: sleva.kod.code,
    celkemPredSlevou: sleva.celkemPredSlevou,
    sleva: sleva.sleva,
    celkem: sleva.celkemPoSleve,
    polozky: produkty.radky.map((radek, poradi) => {
      const cena = sleva.ceny.get(radek.productId)!;
      return {
        id: radek.productId,
        nazev: produkty.nazvy[poradi]!,
        pocet: radek.quantity,
        cenaPredSlevou: sDph(cena.listNetPrice, cena.vatPercent),
        cena: sDph(cena.netPrice, cena.vatPercent),
      };
    }),
  };
}
