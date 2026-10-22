import { after } from "next/server";
import { z } from "zod";

import { zapisDoAuditu, type Transakce } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { odesliNovehoKlienta, odesliSouhlasZObjednavky } from "@/lib/smartemailing";
import { sjednotTelefon, telefonKPorovnani } from "@/lib/telefon";
import { dataKlienta, posliWebhook } from "@/lib/webhooky";

/**
 * Příjem klientů z webu (`POST /api/leady`, Jakub, 12. 9. 2026).
 *
 * Sem ústí formuláře na webu a další systémy mimo CRM. Celá logika je
 * tady, ne v obsluze adresy — ta jen ověří klíč a předá data dál.
 *
 * Pravidla, na kterých to stojí:
 *
 * 1. **Co přijde zvenčí, je vždy podezřelé** (security_warnings.md,
 *    pravidlo 11). Každé pole má typ, délku i tvar; nic se nepředává
 *    do databáze tak, jak dorazilo.
 * 2. **E-mail je povinný, telefon ne** (Jakub, 15. 9. 2026; do té doby
 *    stačil jeden z nich). Lead bez e-mailu se odmítne — formulář na webu
 *    musí mít e-mail povinný. Duplicita se dál hledá i podle telefonu.
 * 3. **Klient bez obchodníka nevznikne.** Komu leady padají, se vybírá
 *    v Nastavení → Příjem leadů. Dokud tam nikdo není, endpoint nic
 *    nepřijímá — radši hlasitá chyba než klient, kterého nikdo nevidí.
 * 4. **Brokeři od klienta jsou jen informace** (Jakub, 25. 9. 2026).
 *    Uloží se ke klientovi (`reportedBrokers`) a do poznámky; portfolio
 *    nevzniká (do 25. 9. ho nalezený broker zakládal) a katalog se
 *    nemění. Klient může uvést víc brokerů, nebo „Nemám brokera".
 * 5. **Duplicita nezakládá druhého klienta.** Když už toho člověka máme,
 *    připíše se mu poznámka, že se ozval znovu.
 * 6. **Do logu se nedostane obsah leadu** (pravidlo 8) — jména, e-maily
 *    ani telefony. Chyby se hlásí návratovou hodnotou, ne výpisem.
 * 7. **Nový klient se souhlasem jde do SmartEmailingu** stejně jako klient
 *    z formuláře (Jakub, 15. 9. 2026). Bez souhlasu se jen zapíše do CRM
 *    a poznámka řekne proč. U klienta, kterého už máme, se souhlas nemění.
 */

/** Měny, ve kterých se portfolio vede. Stejný seznam jako ve formuláři. */
const MENA = z.enum(["CZK", "EUR", "USD"]);

/** Kolik brokerů smí klient najednou uvést. */
export const MAX_BROKERU = 10;

/**
 * Vstup z webu. Česká pojmenování jsou hlavní, anglická se berou taky —
 * formuláře na webu mívají pole pojmenovaná anglicky a přejmenovávat je
 * kvůli nám by byla zbytečná práce.
 */
const vstupSchema = z
  .object({
    jmeno: z.string().trim().max(60).optional(),
    firstName: z.string().trim().max(60).optional(),
    prijmeni: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    email: z.string().trim().max(254).optional(),
    telefon: z.string().trim().max(32).optional(),
    phone: z.string().trim().max(32).optional(),
    /**
     * Brokeři, které klient používá — **jen informace** (Jakub, 25. 9.
     * 2026): uloží se ke klientovi, portfolio nevzniká. Klient jich může
     * zaškrtnout víc (`brokeri`); `broker` s jedním názvem zůstává kvůli
     * formulářům z doby před 25. 9.
     */
    broker: z.string().trim().max(80).optional(),
    brokeri: z.array(z.string().trim().min(1).max(80)).max(MAX_BROKERU).optional(),
    /**
     * Klient zaškrtl „Nemám brokera". Nejde spolu s názvem brokera.
     * U leadu nepovinné, u objednávky je broker povinná volba (hlídá
     * `prijmiObjednavku()`).
     */
    nemamBrokera: z.boolean().optional(),
    /**
     * Měna účtu u brokera. Do 25. 9. 2026 se podle ní zakládalo
     * portfolio; teď se jen přijímá, aby starší formulář nedostal `400`.
     */
    mena: MENA.optional(),
    currency: MENA.optional(),
    /** Souhlas s marketingem, pokud ho formulář na webu sbírá. */
    souhlasMarketing: z.boolean().optional(),
  })
  .strict();

export type VstupLeadu = z.infer<typeof vstupSchema>;

export type VysledekLeadu =
  | {
      ok: true;
      stav: "zalozen" | "duplicita" | "v-kosi" | "vracen";
      klientId: string;
      zprava: string;
    }
  | { ok: false; chyba: string };

/* ---------- Úklid jednotlivých údajů ---------- */

/** Text bez diakritiky a velkých písmen — na porovnávání názvů brokerů. */
function porovnatelne(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const emailSchema = z.email().max(254);

/** E-mail malými písmeny, nebo `null`, když to e-mail není. */
function normalizujEmail(zadany: string): string | null {
  const vysledek = emailSchema.safeParse(zadany.toLowerCase());
  return vysledek.success ? vysledek.data : null;
}

/* ---------- Poznámka ---------- */

/**
 * Co přišlo z webu, se zapíše jako **samostatná poznámka bez autora**
 * (Jakub, 23. 9. 2026) — v okně Poznámky na kartě klienta. Do té doby se
 * to připisovalo na konec jedné společné poznámky (`clients.note`).
 * Běží uvnitř transakce, která klienta zakládá nebo mění.
 */
async function zapisPoznamku(tx: Transakce, clientId: string, text: string): Promise<void> {
  await tx.clientNote.create({ data: { clientId, authorId: null, text } });
}

/* ---------- Brokeři od klienta ---------- */

/**
 * Brokeři, které klient uvedl — **jen informace** (Jakub, 25. 9. 2026).
 *
 * Do 25. 9. 2026 nalezený broker klientovi rovnou zakládal portfolio;
 * teď se jen uloží, co klient uvedl (`clients.reportedBrokers`), a
 * portfolio přiřazuje člověk v okně Upravit. Název, který zná katalog,
 * se sjednotí na jeho podobu („xtb" → „XTB"), neznámý zůstane, jak ho
 * klient napsal — katalog spravuje administrátor. Dvojice se vynechají.
 *
 * Brokerů je v katalogu řádově desítky, porovnává se proto v paměti.
 */
async function uvedeniBrokeri(nazvy: string[]): Promise<string[]> {
  if (nazvy.length === 0) return [];

  // Brokeři v koši se nenabízejí (CLAUDE.md).
  const katalog = await db.broker.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  const vysledek = new Map<string, string>();
  for (const nazev of nazvy) {
    const klic = porovnatelne(nazev);
    if (!klic || vysledek.has(klic)) continue;
    const znamy = katalog.find(
      (broker) => porovnatelne(broker.name) === klic || porovnatelne(broker.id) === klic,
    );
    vysledek.set(klic, znamy?.name ?? nazev.trim());
  }
  return [...vysledek.values()];
}

/** Věta o brokerech do poznámky u klienta, nebo `null`, když klient nic neuvedl. */
function vetaOBrokerech(brokeri: string[], nemaBrokera: boolean): string | null {
  if (brokeri.length > 0) return `Klient uvádí brokera: ${brokeri.join(", ")}.`;
  if (nemaBrokera) return "Klient uvádí, že nemá brokera.";
  return null;
}

/**
 * Máme toho člověka už v systému?
 *
 * Hledá se **i mezi smazanými**: e-mail je v databázi jedinečný napříč
 * košem, takže druhý záznam by stejně nevznikl — a tiché založení
 * dvojníka s jiným telefonem by bylo horší než upozornění.
 *
 * Telefon se porovnává bez mezer — ukládá se `+420 601 234 567`, ale
 * pojistka proti jinak zapsaným číslům nic nestojí.
 */
async function najdiExistujiciho(
  email: string | null,
  telefon: string | null,
): Promise<{
  id: string;
  name: string;
  deletedAt: Date | null;
  consentMarketingAt: Date | null;
} | null> {
  const nalezeny = await najdiPodleUdaju(email, telefon);
  if (!nalezeny) return null;

  /*
   * Sloučená karta (Jakub, 27. 9. 2026) leží ve Smazaných jen jako
   * odkaz — objednávka na její e-mail patří kartě, do které se sloučila.
   * Řetěz se sleduje nejvýš pár kroků, kdyby se slučovalo opakovaně.
   */
  let klient = nalezeny;
  for (let krok = 0; krok < 5 && klient.mergedIntoId; krok++) {
    const cil = await db.client.findUnique({
      where: { id: klient.mergedIntoId },
      select: VYBER_EXISTUJICIHO,
    });
    if (!cil) break;
    klient = cil;
  }

  return {
    id: klient.id,
    name: klient.name,
    deletedAt: klient.deletedAt,
    consentMarketingAt: klient.consentMarketingAt,
  };
}

const VYBER_EXISTUJICIHO = {
  id: true,
  name: true,
  deletedAt: true,
  consentMarketingAt: true,
  mergedIntoId: true,
} as const;

async function najdiPodleUdaju(email: string | null, telefon: string | null) {
  if (email) {
    const podleEmailu = await db.client.findUnique({
      where: { email },
      select: VYBER_EXISTUJICIHO,
    });
    if (podleEmailu) return podleEmailu;
  }

  if (telefon) {
    // Parametrizovaný dotaz, ne skládaný řetězec (pravidlo 11).
    const nalezene = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "clients"
      WHERE regexp_replace("phone", '[^0-9+]', '', 'g') = ${telefonKPorovnani(telefon)}
      ORDER BY ("deletedAt" IS NOT NULL), "createdAt"
      LIMIT 1
    `;

    const id = nalezene[0]?.id;
    if (id) {
      return db.client.findUniqueOrThrow({ where: { id }, select: VYBER_EXISTUJICIHO });
    }
  }

  return null;
}

/* ---------- Nastavení příjmu ---------- */

/**
 * Zdroj, který dostane každý klient z webu (Jakub, 22. 9. 2026).
 *
 * Do té doby se vybíral v Nastavení → Příjem leadů spolu s obchodníkem,
 * kterému klient připadne. Klienti se lidem nepřiřazují a weby máme
 * zatím jediný, takže nebylo co nastavovat a sekce zanikla.
 *
 * Id je pevné, ne hledané podle názvu — zakládá ho migrace
 * `20260922180000_role_a_klienti_bez_majitele`. Kdyby ho někdo
 * z Nastavení → Zdroje klientů smazal, příjem to pozná a řekne to.
 */
export const ZDROJ_LANDING_PAGE = "landing-page";

/** Ověří, že zdroj „Landing Page" v číselníku pořád je. */
async function zdrojZWebu(): Promise<string | null> {
  const zdroj = await db.clientSource.findUnique({
    where: { id: ZDROJ_LANDING_PAGE },
    select: { id: true },
  });

  return zdroj?.id ?? null;
}

/**
 * Věta do poznámky o souhlasu s marketingem (Jakub, 15. 9. 2026).
 *
 * Rozlišuje, jestli klient souhlas nezaškrtl (`false`), nebo ho formulář
 * na webu vůbec neposlal — to druhé bývá chyba v zapojení webu. U klienta,
 * kterého už máme, se souhlas na kartě nemění: mohl ho dřív vědomě odvolat,
 * takže rozhodnutí zůstává na obchodníkovi.
 */
function vetaOSouhlasu(souhlas: boolean | undefined, klient: "novy" | "znamy"): string {
  if (souhlas === true) {
    return klient === "novy"
      ? "Souhlas s marketingem přišel z formuláře na webu."
      : "Ve formuláři na webu je souhlas s marketingem. Na kartě se nezměnil — zaškrtni ho ručně, pokud platí.";
  }

  const proc =
    souhlas === false
      ? "Souhlas s marketingem na webu nebyl udělen"
      : "Formulář na webu souhlas s marketingem neposlal";

  return klient === "novy" ? `${proc} — do SmartEmailingu neodchází.` : `${proc}.`;
}

/**
 * Věta o souhlasu u objednávky z Landing Page (Jakub, 23. 9. 2026).
 *
 * Tam klient souhlas zaškrtává při objednání a údaj chodí povinně, takže
 * „web ho neposlal" nenastane. Zaškrtnutí platí i u klienta, kterého už
 * máme — nezaškrtnutí mu ale dřívější souhlas nebere.
 */
function vetaOSouhlasuZObjednavky(
  souhlas: boolean,
  klient: "novy" | "udelen" | "uz-mel" | "bez-souhlasu",
): string {
  if (klient === "novy") {
    return souhlas
      ? "Souhlas s marketingem udělen při objednávce."
      : "Souhlas s marketingem při objednávce udělen nebyl — do SmartEmailingu neodchází.";
  }
  if (klient === "udelen") return "Souhlas s marketingem udělen při objednávce.";
  if (klient === "uz-mel") {
    return souhlas
      ? "Souhlas s marketingem při objednávce znovu potvrzen."
      : "Souhlas s marketingem při objednávce nezaškrtnut; dřívější souhlas zůstává.";
  }
  return "Souhlas s marketingem při objednávce udělen nebyl.";
}

/* ---------- Příjem ---------- */

/**
 * Přijme lead z webu: buď založí klienta, nebo připíše poznámku
 * k tomu, kterého už máme.
 *
 * Zápis do auditního logu je součástí obojího a běží ve stejné transakci
 * (pravidlo 7). U změny není žádný uživatel — neudělal ji člověk.
 *
 * **`objednavka: true`** volá příjem objednávek z Landing Page (Jakub,
 * 23. 9. 2026) a mění dvě věci proti leadu:
 * - **klienta ze Smazaných vrátí** mezi klienty, aby se objednávka
 *   neztratila. Lead ho ve Smazaných nechává — tam je to jen poznámka,
 *   ne peníze;
 * - **zaškrtnutý souhlas platí i pro známého klienta**, který ho zatím
 *   nemá. Zaškrtnutí je vědomě daný souhlas; nezaškrtnutí ale dřívější
 *   souhlas neodebírá.
 */
export async function prijmiLead(
  telo: unknown,
  { objednavka = false }: { objednavka?: boolean } = {},
): Promise<VysledekLeadu> {
  const vstup = vstupSchema.safeParse(telo);
  if (!vstup.success) {
    return { ok: false, chyba: "Neznámé nebo příliš dlouhé pole v požadavku." };
  }

  const data = vstup.data;

  // Brokeři od klienta — `broker` (jeden, starší formuláře) a `brokeri`
  // (víc zaškrtnutých) dohromady. S „Nemám brokera" se vylučují.
  const zadaniBrokeri = [data.broker ?? "", ...(data.brokeri ?? [])]
    .map((nazev) => nazev.trim())
    .filter(Boolean);
  const nemaBrokera = data.nemamBrokera === true;
  if (nemaBrokera && zadaniBrokeri.length > 0) {
    return { ok: false, chyba: "Pošli buď brokery (brokeri), nebo nemamBrokera — ne obojí." };
  }

  const zadanyEmail = data.email ?? "";
  if (!zadanyEmail) return { ok: false, chyba: "Chybí e-mail — bez něj se klient nezaloží." };
  const email = normalizujEmail(zadanyEmail);
  if (!email) return { ok: false, chyba: "E-mail nemá platný tvar." };

  const zadanyTelefon = data.telefon ?? data.phone ?? "";
  const telefon = zadanyTelefon ? sjednotTelefon(zadanyTelefon) : null;
  if (zadanyTelefon && !telefon) {
    return { ok: false, chyba: "Telefon nemá platný tvar — čekáme 9 až 15 číslic." };
  }

  const jmeno = (data.jmeno ?? data.firstName ?? "").trim();
  const prijmeni = (data.prijmeni ?? data.lastName ?? "").trim();
  const celeJmeno = [jmeno, prijmeni].filter(Boolean).join(" ");

  const sourceId = await zdrojZWebu();
  if (!sourceId) {
    return {
      ok: false,
      chyba: "Zdroj „Landing Page“ v CRM chybí — obnov ho v Nastavení → Zdroje klientů.",
    };
  }

  const brokeri = await uvedeniBrokeri(zadaniBrokeri);
  /**
   * Klient o brokerech něco uvedl (seznam, nebo „Nemám brokera") — jen
   * tehdy se u něj údaj přepíše. Platí poslední uvedení.
   */
  const uvedlBrokery = brokeri.length > 0 || nemaBrokera;

  const ted = new Date();
  const den = formatDatum(ted);

  const existujici = await najdiExistujiciho(email, telefon);

  /* --- Už ho máme: nový záznam nevzniká, jen se připíše poznámka. --- */
  if (existujici) {
    // Jen u objednávky (viz popis funkce). Lead obojí nechává na člověku.
    const vratit = objednavka && existujici.deletedAt !== null;
    const udelitSouhlas =
      objednavka && data.souhlasMarketing === true && existujici.consentMarketingAt === null;

    const radky = [
      objednavka
        ? `${den} — další objednávka z Landing Page.`
        : `${den} — další zpráva z formuláře na webu.`,
      vratit ? "Klient byl ve Smazaných, objednávka ho vrátila mezi klienty." : null,
      celeJmeno ? `Uvedené jméno: ${celeJmeno}.` : null,
      `E-mail: ${email}.`,
      telefon ? `Telefon: ${telefon}.` : null,
      vetaOBrokerech(brokeri, nemaBrokera),
      objednavka
        ? vetaOSouhlasuZObjednavky(
            Boolean(data.souhlasMarketing),
            udelitSouhlas ? "udelen" : existujici.consentMarketingAt ? "uz-mel" : "bez-souhlasu",
          )
        : vetaOSouhlasu(data.souhlasMarketing, "znamy"),
    ].filter(Boolean);

    await db.$transaction(async (tx) => {
      await zapisPoznamku(tx, existujici.id, radky.join(" "));

      // Brokeři od klienta — platí poslední uvedení, i u klienta ve
      // Smazaných. Portfolio se nezakládá (jen informace).
      if (uvedlBrokery) {
        await tx.client.update({
          where: { id: existujici.id },
          data: { reportedBrokers: brokeri, brokersReportedAt: ted },
        });
      }

      if (vratit || udelitSouhlas) {
        await tx.client.update({
          where: { id: existujici.id },
          data: {
            ...(vratit ? { deletedAt: null } : {}),
            // Znovu udělený souhlas — dřívější odhlášení z odběru už neplatí,
            // stejně jako při ruční úpravě klienta.
            ...(udelitSouhlas ? { consentMarketingAt: ted, smartemailingOptedOutAt: null } : {}),
          },
        });
      }

      if (vratit) {
        await zapisDoAuditu(tx, {
          userId: null,
          entity: "clients",
          entityId: existujici.id,
          action: "klient.vracen-objednavkou",
          after: { name: existujici.name },
        });
      }

      if (udelitSouhlas) {
        await zapisDoAuditu(tx, {
          userId: null,
          entity: "clients",
          entityId: existujici.id,
          action: "klient.souhlas-z-objednavky",
          after: { souhlasMarketing: true },
        });
      }

      await zapisDoAuditu(tx, {
        userId: null,
        entity: "clients",
        entityId: existujici.id,
        action: "klient.opakovany-z-webu",
        after: { brokeri, nemaBrokera },
      });
    });

    // Až po zápisu, přes `after()` — výpadek SmartEmailingu nesmí shodit
    // ani zdržet příjem objednávky.
    if (udelitSouhlas) after(() => odesliSouhlasZObjednavky(existujici.id));

    if (vratit) {
      return {
        ok: true,
        stav: "vracen",
        klientId: existujici.id,
        zprava: "Klient byl ve Smazaných, objednávka ho vrátila mezi klienty.",
      };
    }

    if (existujici.deletedAt) {
      return {
        ok: true,
        stav: "v-kosi",
        klientId: existujici.id,
        zprava: "Klienta už v systému máme, ale je smazaný. Poznámka se k němu zapsala.",
      };
    }

    return {
      ok: true,
      stav: "duplicita",
      klientId: existujici.id,
      zprava: "Klienta už v systému máme, k jeho kartě se zapsala poznámka.",
    };
  }

  /* --- Nový klient. --- */

  // Bezejmenný řádek v seznamu by nikdo nepoznal, tak se jméno vezme
  // z kontaktu a do poznámky se napíše, že nedorazilo.
  const nazev = celeJmeno || email;

  const radky = [
    objednavka
      ? `${den} — klient přišel z objednávky na Landing Page.`
      : `${den} — klient přišel z webu.`,
    celeJmeno ? null : "Jméno ve formuláři nedorazilo, doplň ho.",
    vetaOBrokerech(brokeri, nemaBrokera),
    objednavka
      ? vetaOSouhlasuZObjednavky(Boolean(data.souhlasMarketing), "novy")
      : vetaOSouhlasu(data.souhlasMarketing, "novy"),
  ].filter(Boolean);

  const klient = await db.$transaction(async (tx) => {
    const novy = await tx.client.create({
      data: {
        name: nazev,
        email,
        phone: telefon,
        sourceId,
        stage: "NOVY",
        // Souhlas se eviduje s datem (pravidlo 6). Když nepřišel,
        // zůstává prázdný — marketing se pak odeslat nesmí.
        consentMarketingAt: data.souhlasMarketing ? ted : null,
        // Brokeři od klienta — jen informace, portfolio nevzniká.
        reportedBrokers: brokeri,
        brokersReportedAt: uvedlBrokery ? ted : null,
      },
      select: { id: true, name: true, stage: true },
    });

    await zapisPoznamku(tx, novy.id, radky.join(" "));

    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: novy.id,
      action: "klient.z-webu",
      after: {
        name: novy.name,
        stage: novy.stage,
        zdroj: "landing-page",
        souhlasMarketing: Boolean(data.souhlasMarketing),
        brokeri,
        nemaBrokera,
      },
    });

    return novy;
  });

  // Se souhlasem rovnou do SmartEmailingu, stejně jako klient z formuláře
  // (Jakub, 15. 9. 2026). Až po odpovědi — výpadek SmartEmailingu nesmí
  // shodit ani zdržet příjem leadu. Souhlas, e-mail a zapnuté propojení
  // ověří `odesliNovehoKlienta()` sama. „Kdo" v auditu je prázdné jako
  // u leadu samotného — změnu neudělal člověk.
  if (data.souhlasMarketing) {
    after(() => odesliNovehoKlienta(klient.id, null));
  }
  // Odchozí webhooky (19. 10. 2026) — bez kontaktů.
  posliWebhook("klient.novy", () => dataKlienta(klient.id));

  return {
    ok: true,
    stav: "zalozen",
    klientId: klient.id,
    zprava: "Klient byl založen.",
  };
}
