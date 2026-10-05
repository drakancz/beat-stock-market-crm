import { after } from "next/server";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniNaZaplaceni } from "@/lib/klient/oznameni";
import { MAX_BROKERU, prijmiLead } from "@/lib/leady";
import { opisDelkuPlatnosti, prepocitejPlatnost } from "@/lib/platnost";

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
 */

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
  })
  .strict();

export type VstupObjednavky = z.infer<typeof vstupSchema>;

export type VysledekObjednavky =
  | { ok: true; objednavkaId: string; cislo: string; klientId: string; zprava: string }
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

  const objednavka = await db.$transaction(async (tx) => {
    const zalozena = await tx.order.create({
      data: {
        name: nazev,
        clientId: lead.klientId,
        status: stav,
        // Přístup do programu je od 23. 9. 2026 u klienta a objednávka
        // ho nemění — zařizuje ho člověk, i u zaplacené objednávky.
        currency: produkty.mena,
        paidAt: stav === "ZAPLACENO" ? new Date() : null,
        items: {
          create: produkty.radky.map((radek) => ({
            productId: radek.productId,
            quantity: radek.quantity,
          })),
        },
      },
      select: { id: true, number: true },
    });

    // Objednávka zaplacená rovnou přes bránu hned prodlouží platnost
    // členství (Jakub, 24. 9. 2026) — stejně jako ruční přepnutí stavu.
    if (stav === "ZAPLACENO") {
      await opisDelkuPlatnosti(tx, zalozena.id, true);
      await prepocitejPlatnost(tx, lead.klientId);
    }

    // „Kdo" je prázdné — objednávku nevytvořil člověk z týmu, ale klient
    // na Landing Page. V Aktivitě se to ukazuje jako web.
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
        zdroj: "landing-page",
      },
    });

    return zalozena;
  });

  // Zaplacená rovnou přes bránu — klient dostane upozornění (3A,
  // 4. 10. 2026), jen když už má účet v klientské části.
  if (stav === "ZAPLACENO") after(() => upozorniNaZaplaceni(objednavka.id));

  return {
    ok: true,
    objednavkaId: objednavka.id,
    cislo: objednavka.number,
    klientId: lead.klientId,
    zprava: `Objednávka ${objednavka.number} je zapsaná.`,
  };
}
