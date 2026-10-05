import type { Prisma } from "@/generated/prisma/client";
import type { CallOutcome, OrderStatus, ProductKind } from "@/generated/prisma/enums";
import { cenaPolozkyBezDph, cenaPolozkySDph, sDph } from "@/lib/dph";
import { db } from "@/lib/db";
import { klientiPodleTelefonu, klientiPodleTextu, produktyPodleTextu } from "@/lib/hledani";
import {
  dnesVPraze,
  jakoDen,
  krokProObdobi,
  krokyObdobi,
  popisekKroku,
  posunDne,
  zacatekKroku,
  type Obdobi,
} from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import type { Viewer } from "@/lib/session";
import { CALL_OUTCOMES, DRUHY_BEZ_PLATNOSTI, ORDER_STATUSES, OUTCOME_LABEL } from "@/lib/types";

/**
 * Čtení dat z databáze.
 *
 * Omezení viditelnosti se vyhodnocuje **v dotazu do databáze**, ne až nad
 * výsledkem a nikdy skrytím tlačítka v rozhraní (security_warnings.md,
 * pravidlo 5). Kdo zná adresu, dostane se tam i bez tlačítka — proto to
 * musí ustát samotný dotaz.
 *
 * Funkce vracejí prostá čísla a řetězce, ne Decimal objekty Prismy, aby
 * šly bez potíží předat do komponent.
 */

/**
 * Kteří klienti se smí zobrazit.
 *
 * **Od 22. 9. 2026 je vidí každý přihlášený** (Jakub). Klienti se nikomu
 * nepřiřazují — objednávky chodí z Landing Page, takže dělit je mezi lidi
 * nemá co řídit. Role rozhoduje už jen o tom, kdo spravuje systém.
 *
 * Funkce zůstává, i když se podle role nevětví: prochází jí **každý**
 * dotaz na klienty a s ním i podmínka `deletedAt: null`. Kdyby se
 * omezení někdy vrátilo, přibude na jednom místě.
 *
 * Odložení klienti (`deletedAt`) tu nejsou nikdy — ani pro administrátora.
 * Jsou vidět jen ve společném koši, který si je načítá sám.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- parametr zůstává kvůli tvaru volání, viz komentář výš
export function viditelniKlienti(viewer: Viewer): Prisma.ClientWhereInput {
  return { deletedAt: null };
}

/** Portfolia, která má daná role vidět — bez odložených a bez cizích klientů. */
export function viditelnaPortfolia(viewer: Viewer): Prisma.PortfolioWhereInput {
  return { deletedAt: null, client: viditelniKlienti(viewer) };
}

const cislo = (hodnota: Prisma.Decimal) => hodnota.toNumber();

/* ---------- Klienti ---------- */

/** Co si člověk vyplnil ve filtrech nad seznamem klientů. */
export interface FiltrKlientu {
  /** Jméno, e-mail nebo telefon — hledá se ve všech třech. */
  hledat?: string;
}

/**
 * Filtry přeložené do podmínek dotazu.
 *
 * **Filtr nikdy rozsah nerozšíří, jen zúží** — výsledek se vždy skládá
 * s `viditelniKlienti()` přes `AND`.
 *
 * Filtr „podle obchodníka" tu byl do 22. 9. 2026; klienti se od té doby
 * lidem nepřiřazují, takže nemá co filtrovat.
 */
async function podleFiltru(filtr: FiltrKlientu): Promise<Prisma.ClientWhereInput[]> {
  const podminky: Prisma.ClientWhereInput[] = [];

  const hledat = filtr.hledat?.trim();
  if (hledat) {
    // Jméno a e-mail bez ohledu na diakritiku (Jakub, 25. 9. 2026) —
    // shodu najde `klientiPodleTextu()`, Prisma dostane jen id. Text jde
    // do dotazu jako parametr (security_warnings.md, pravidlo 11).
    // Telefon bez ohledu na mezery (26. 9. 2026) — `klientiPodleTelefonu()`.
    const [podleTextu, podleTelefonu] = await Promise.all([
      klientiPodleTextu(hledat),
      klientiPodleTelefonu(hledat),
    ]);
    podminky.push({ id: { in: [...podleTextu, ...podleTelefonu] } });
  }

  return podminky;
}

/**
 * Jedno datum do sloupce Platnost do v seznamu klientů.
 *
 * Když klientovi něco běží, ukáže se **nejbližší konec** — to je to, co
 * bude potřeba řešit nejdřív. Když už mu všechno skončilo, ukáže se
 * poslední konec s tím, že skončilo. Bez platnosti `null`.
 */
function shrnPlatnost(konce: number[], dnes: number): { do: Date; skoncilo: boolean } | null {
  if (konce.length === 0) return null;

  const bezici = konce.filter((konec) => konec >= dnes);
  if (bezici.length > 0) return { do: new Date(Math.min(...bezici)), skoncilo: false };
  return { do: new Date(Math.max(...konce)), skoncilo: true };
}

export async function nactiKlienty(viewer: Viewer, filtr: FiltrKlientu = {}) {
  const klienti = await db.client.findMany({
    where: { AND: [viditelniKlienti(viewer), ...(await podleFiltru(filtr))] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      source: { select: { name: true } },
      programAccess: true,
      /*
       * Počet a datum poslední objednávky (Jakub, 23. 9. 2026) — nahradily
       * sloupce Portfolia a Poslední kontakt. Počítají se **všechny**
       * objednávky bez ohledu na platbu, smazané ne. Stav je tu kvůli
       * zvýraznění klienta, který zaplatil a přístup do programu nemá.
       */
      orders: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      },
      /** Sloupec Platnost do (Jakub, 24. 9. 2026). */
      platnosti: { where: { validUntil: { not: null } }, select: { validUntil: true } },
    },
  });

  const dnes = dnesniZacatek().getTime();

  return (
    klienti
      .map((klient) => ({
        id: klient.id,
        name: klient.name,
        // Pod jménem v seznamu je e-mail i telefon (Jakub, 23. 9. 2026) —
        // do té doby jen jedno z nich.
        email: klient.email,
        phone: klient.phone,
        source: klient.source.name,
        pocetObjednavek: klient.orders.length,
        posledniObjednavka: klient.orders[0]?.createdAt ?? null,
        /** Přístup do programu — od 23. 9. 2026 jeden za klienta. */
        programAccess: klient.programAccess,
        /** Má aspoň jednu zaplacenou objednávku — kvůli upozornění na přístup. */
        zaplatil: klient.orders.some((objednavka) => objednavka.status === "ZAPLACENO"),
        platnost: shrnPlatnost(
          klient.platnosti.map((radek) => radek.validUntil!.getTime()),
          dnes,
        ),
      }))
      /*
       * Řazení podle poslední objednávky, nejnovější nahoře (Jakub,
       * 23. 9. 2026). Klienti bez objednávky jsou na konci, mezi sebou
       * podle jména — to drží `orderBy` v dotazu, řazení v JavaScriptu je
       * stabilní. Řadí se tady, ne v databázi: Prisma neumí řadit podle
       * nejnovějšího záznamu ve vazbě a seznam se nestránkuje.
       */
      .sort((a, b) => {
        const casA = a.posledniObjednavka?.getTime();
        const casB = b.posledniObjednavka?.getTime();
        if (casA === casB) return 0;
        if (casA === undefined) return 1;
        if (casB === undefined) return -1;
        return casB - casA;
      })
  );
}

/**
 * Kolik klientů zaplatilo, ale přístup do programu nemá (Jakub,
 * 23. 9. 2026 — do té doby se počítaly objednávky v sekci Objednávky).
 * Počítá se přes všechny viditelné klienty, ne jen přes vyhledané, ať
 * upozornění nezmizí jen proto, že si člověk zrovna něco hledá.
 */
export async function pocetCekajicichNaPristup(viewer: Viewer): Promise<number> {
  return db.client.count({
    where: {
      AND: [
        viditelniKlienti(viewer),
        { programAccess: "NEPOVOLEN" },
        { orders: { some: { status: "ZAPLACENO", deletedAt: null } } },
      ],
    },
  });
}

/**
 * Kolik klientů má členství za sebou, ale přístup do programu povolený
 * (Jakub, 25. 9. 2026). Přístup se po konci sám nevypíná — tohle je
 * jen upozornění, vypnout ho musí administrátor.
 *
 * „Skončilo" znamená, že klientovi **už nic neběží**: má aspoň jednu
 * platnost a žádná nesahá do dneška. Stejné pravidlo jako „skončilo"
 * ve sloupci Platnost do (`shrnPlatnost()`). Počítá se přes všechny
 * viditelné klienty, ne jen přes vyhledané.
 */
export async function pocetPoKonciSPristupem(viewer: Viewer): Promise<number> {
  const dnes = dnesniZacatek();
  return db.client.count({
    where: {
      AND: [
        viditelniKlienti(viewer),
        { programAccess: "POVOLEN" },
        { platnosti: { some: { validUntil: { not: null } } } },
        { platnosti: { none: { validUntil: { gte: dnes } } } },
      ],
    },
  });
}

/**
 * Karta klienta.
 *
 * Od 23. 9. 2026 (Jakub) karta ukazuje jen údaje, objednávky, přílohy
 * a poznámky — záložky Časová osa, Hovory, Portfolia a Úkoly zmizely,
 * takže se hovory, úkoly ani aktivity nenačítají. Portfolia jen kvůli
 * oddílu Brokeři ve formuláři Upravit (nabízí se ten, u koho klient
 * ještě portfolio nemá).
 */
export async function nactiKlienta(viewer: Viewer, id: string) {
  // Podmínka viditelnosti je součástí dotazu — klient mimo rozsah role
  // se nenajde, i když někdo zná jeho adresu.
  const klient = await db.client.findFirst({
    where: { AND: [{ id }, viditelniKlienti(viewer)] },
    include: {
      portfolios: {
        // Broker v koši se u klienta neukazuje — v seznamech není.
        where: { deletedAt: null, broker: { deletedAt: null } },
        orderBy: { broker: { name: "asc" } },
        select: { id: true, brokerId: true, currency: true, broker: { select: { name: true } } },
      },
    },
  });

  if (!klient) return null;

  return {
    id: klient.id,
    name: klient.name,
    email: klient.email,
    phone: klient.phone,
    sourceId: klient.sourceId,
    stage: klient.stage,
    /** Přístup do programu — od 23. 9. 2026 jeden za klienta. */
    programAccess: klient.programAccess,
    /** Kvůli hlídání čerstvého odeslání do SmartEmailingu. */
    createdAt: klient.createdAt,
    consentMarketingAt: klient.consentMarketingAt,
    consentRecordingAt: klient.consentRecordingAt,
    /** Kdy odešel do SmartEmailingu, nebo kód chyby, proč ne. */
    smartemailingSentAt: klient.smartemailingSentAt,
    smartemailingError: klient.smartemailingError,
    /** Co SmartEmailing při chybě odpověděl, bez e-mailových adres — jen pro administrátora. */
    smartemailingErrorDetail: klient.smartemailingErrorDetail,
    /** Kdy se o odeslání naposledy pokusilo — podle toho karta pozná, že výsledek už je. */
    smartemailingAttemptAt: klient.smartemailingAttemptAt,
    /** Kdy CRM klienta ve SmartEmailingu odhlásilo po odebrání souhlasu. */
    smartemailingUnsubscribedAt: klient.smartemailingUnsubscribedAt,
    /** Kdy se klient ve SmartEmailingu sám odhlásil z odběru a přišel o souhlas. */
    smartemailingOptedOutAt: klient.smartemailingOptedOutAt,
    /** Brokeři, které klient uvedl při objednávce či na webu — jen informace (25. 9. 2026). */
    reportedBrokers: klient.reportedBrokers,
    brokersReportedAt: klient.brokersReportedAt,
    /** Brokeři klienta — kvůli oddílu Brokeři ve formuláři Upravit (od 25. 9. 2026). */
    brokeri: klient.portfolios.map((portfolio) => ({
      portfolioId: portfolio.id,
      nazev: portfolio.broker.name,
      mena: portfolio.currency,
    })),
    /** U kterých brokerů už portfolio má — kvůli výběru ve formuláři. */
    brokerIds: klient.portfolios.map((portfolio) => portfolio.brokerId),
  };
}

/** Jedna poznámka v okně Poznámky na kartě klienta. */
export interface PoznamkaKZobrazeni {
  id: string;
  text: string;
  createdAt: Date;
  /** Kdo ji napsal. `null` = systém (web, objednávka, převod staré poznámky). */
  authorId: string | null;
  authorName: string | null;
  /** Zapsala ji AI přes MCP jménem autora (Jakub, 5. 10. 2026). */
  createdViaMcp: boolean;
}

/**
 * Poznámky klienta od nejnovější (Jakub, 23. 9. 2026).
 *
 * Viditelnost jde přes klienta — poznámku uvidí jen ten, kdo vidí
 * samotného klienta. Smazané se neukazují.
 */
export async function nactiPoznamkyKlienta(
  viewer: Viewer,
  klientId: string,
): Promise<PoznamkaKZobrazeni[]> {
  const poznamky = await db.clientNote.findMany({
    where: { AND: [{ clientId: klientId, deletedAt: null }, { client: viditelniKlienti(viewer) }] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      createdAt: true,
      authorId: true,
      author: { select: { name: true } },
      createdViaMcp: true,
    },
  });

  return poznamky.map((poznamka) => ({
    id: poznamka.id,
    text: poznamka.text,
    createdAt: poznamka.createdAt,
    authorId: poznamka.authorId,
    authorName: poznamka.author?.name ?? null,
    createdViaMcp: poznamka.createdViaMcp,
  }));
}

/** Platnost jednoho produktu na kartě klienta. */
export interface PlatnostKZobrazeni {
  productId: string;
  produkt: string;
  /** Poslední den platnosti (včetně). */
  do: Date;
  skoncilo: boolean;
}

/**
 * Do kdy klientovi běží produkty (Jakub, 24. 9. 2026) — karta klienta.
 *
 * **Vidí každý přihlášený**, kdo vidí klienta; viditelnost jde přes
 * klienta. Nejdřív to, co běží (nejbližší konec první), pod tím to, co už
 * skončilo.
 */
export async function nactiPlatnostiKlienta(
  viewer: Viewer,
  klientId: string,
): Promise<PlatnostKZobrazeni[]> {
  const radky = await db.productValidity.findMany({
    where: {
      AND: [
        { clientId: klientId, validUntil: { not: null } },
        { client: viditelniKlienti(viewer) },
      ],
    },
    orderBy: { validUntil: "asc" },
    select: { productId: true, validUntil: true, product: { select: { name: true } } },
  });

  const dnes = dnesniZacatek().getTime();
  const platnosti = radky.map((radek) => ({
    productId: radek.productId,
    produkt: radek.product.name,
    do: radek.validUntil!,
    skoncilo: radek.validUntil!.getTime() < dnes,
  }));

  return [
    ...platnosti.filter((platnost) => !platnost.skoncilo),
    ...platnosti.filter((platnost) => platnost.skoncilo).reverse(),
  ];
}

/**
 * Produkty, u kterých jde klientovi ručně upravit konec platnosti — ty
 * s délkou v ceníku a ty, které už platnost mají. Jen pro okno Upravit
 * platnost; to vidí administrátor.
 */
export async function nactiProduktySPlatnosti() {
  return db.product.findMany({
    // Smazaný produkt jen tehdy, když už někomu platnost má — ta se dá
    // dál ručně upravit; nový řádek pro něj nevznikne.
    // Kurz platí napořád, konzultace je jednorázová — konec se nenastavuje.
    where: {
      kind: { notIn: DRUHY_BEZ_PLATNOSTI },
      OR: [{ validityMonths: { not: null }, deletedAt: null }, { platnosti: { some: {} } }],
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/* ---------- Můj den ---------- */

/**
 * Nehotové úkoly přihlášeného, nejbližší termín první.
 *
 * Čte je blok „Můj den" na Dashboardu. **Úmyslně se neřídí zvoleným
 * obdobím** — úkol po termínu musí být vidět, i když si člověk přepne
 * čísla na minulý měsíc.
 *
 * Do 22. 9. 2026 to bylo součástí obrazovky Dnešek, která se zrušila
 * a sloučila do Dashboardu. Tehdejší dotaz tahal i hovory a dvě počítadla
 * do dlaždic; ty se nepřenášely, takže tenhle čte jen úkoly.
 */
export async function nactiMojeUkoly(viewer: Viewer) {
  const ukoly = await db.task.findMany({
    where: { userId: viewer.id, doneAt: null, deletedAt: null },
    orderBy: { dueAt: "asc" },
    include: { client: { select: { id: true, name: true } } },
  });

  return ukoly.map((ukol) => ({
    id: ukol.id,
    title: ukol.title,
    dueAt: ukol.dueAt,
    clientId: ukol.client.id,
    clientName: ukol.client.name,
    createdViaMcp: ukol.createdViaMcp,
  }));
}

/**
 * Připomínky úkolů pro zvoneček v horní liště (Jakub, 26. 9. 2026).
 *
 * **Jen vlastní úkoly přihlášeného** — stejně jako Můj den. Omezení je
 * v dotazu (`userId: viewer.id`), ne v zobrazení. Připomínají se nehotové
 * úkoly s termínem **dnes a po termínu**; zítřek ne, ranní e-mail přijde
 * až se SES.
 *
 * „Dnes" je pražský den (`dnesniZacatek()`), ne den serveru — ten běží
 * v UTC a termín 26. 9. je v databázi 25. 9. 22:00 UTC.
 */
export async function nactiPripominky(viewer: Viewer) {
  const dnes = dnesniZacatek();
  const zitra = posunDne(dnes, 1);

  const ukoly = await db.task.findMany({
    where: { userId: viewer.id, doneAt: null, deletedAt: null, dueAt: { lt: zitra } },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      title: true,
      dueAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  return ukoly.map((ukol) => ({
    id: ukol.id,
    title: ukol.title,
    dueAt: ukol.dueAt,
    poTerminu: ukol.dueAt < dnes,
    clientId: ukol.client.id,
    clientName: ukol.client.name,
  }));
}

/* ---------- Portfolia ---------- */

export async function nactiPortfolia(viewer: Viewer) {
  const portfolia = await db.portfolio.findMany({
    where: viditelnaPortfolia(viewer),
    orderBy: [{ client: { name: "asc" } }, { broker: { name: "asc" } }],
    include: {
      client: { select: { id: true, name: true } },
      broker: { select: { name: true } },
    },
  });

  return portfolia.map((portfolio) => ({
    id: portfolio.id,
    clientId: portfolio.client.id,
    clientName: portfolio.client.name,
    brokerName: portfolio.broker.name,
    source: portfolio.source,
    currency: portfolio.currency,
    invested: cislo(portfolio.invested),
    value: cislo(portfolio.value),
    lastSyncAt: portfolio.lastSyncAt,
  }));
}

export async function nactiPozice(viewer: Viewer) {
  const pozice = await db.position.findMany({
    where: { portfolio: viditelnaPortfolia(viewer) },
    orderBy: [{ portfolio: { client: { name: "asc" } } }, { ticker: "asc" }],
    include: {
      portfolio: {
        select: { currency: true, client: { select: { id: true, name: true } } },
      },
    },
  });

  return pozice.map((polozka) => ({
    id: polozka.id,
    ticker: polozka.ticker,
    name: polozka.name,
    clientId: polozka.portfolio.client.id,
    clientName: polozka.portfolio.client.name,
    currency: polozka.portfolio.currency,
    quantity: cislo(polozka.quantity),
    averagePrice: cislo(polozka.averagePrice),
    currentPrice: cislo(polozka.currentPrice),
  }));
}

/* ---------- Zdroje klientů ---------- */

/**
 * Zdroje klientů, jak je spravuje administrátor v Nastavení.
 *
 * Vrací i skryté — formulář klienta si z nich nabídne jen aktivní
 * a ten, který klient už má. Počet klientů je bez klientů v koši.
 */
export async function nactiZdrojeKlientu() {
  const zdroje = await db.clientSource.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      active: true,
      _count: { select: { clients: { where: { deletedAt: null } } } },
    },
  });

  return zdroje.map((zdroj) => ({
    id: zdroj.id,
    name: zdroj.name,
    active: zdroj.active,
    klientu: zdroj._count.clients,
  }));
}

/* ---------- Produkty ---------- */

export async function nactiProdukty() {
  const [produkty, prodaneKusy] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        vatRate: { select: { id: true, name: true, rate: true } },
      },
    }),
    /*
     * Prodáno (Jakub, 24. 9. 2026) — součet **kusů** v zaplacených
     * objednávkách. Nezaplacené a smazané se nepočítají, stejně jako
     * u tržeb v Cílech. Nahradilo sloupec Zájem (počet hovorů).
     */
    db.orderItem.groupBy({
      by: ["productId"],
      where: { order: { status: "ZAPLACENO", deletedAt: null } },
      _sum: { quantity: true },
    }),
  ]);

  const prodano = new Map(prodaneKusy.map((radek) => [radek.productId, radek._sum.quantity ?? 0]));

  return produkty.map((produkt) => {
    const cenaBezDph = cislo(produkt.netPrice);
    const sazba = cislo(produkt.vatRate.rate);

    return {
      id: produkt.id,
      name: produkt.name,
      kind: produkt.kind,
      /** Cena bez DPH — s tou se počítají hodnoty zakázek i statistiky. */
      cenaBezDph,
      /** Táž cena včetně DPH, kolik zaplatí klient. Dopočítává se ze sazby. */
      cenaSDph: sDph(cenaBezDph, sazba),
      sazbaId: produkt.vatRate.id,
      sazbaNazev: produkt.vatRate.name,
      /** Výše sazby v procentech. */
      sazba,
      currency: produkt.currency,
      active: produkt.active,
      /** Odkaz na stránku produktu (jen https), nebo `null`. */
      url: produkt.url,
      /** Platnost v měsících od zaplacení, `null` = nekončí. */
      validityMonths: produkt.validityMonths,
      /** Kolik kusů je prodaných v zaplacených objednávkách. */
      prodano: prodano.get(produkt.id) ?? 0,
    };
  });
}

/**
 * Tři sazby DPH v pořadí, v jakém stojí v Nastavení i ve výběru u produktu.
 *
 * Každý přihlášený je potřebuje k výpočtu cen s DPH; měnit je smí jen
 * administrátor (`src/app/(app)/nastaveni/actions.ts`).
 */
export async function nactiSazbyDph() {
  const sazby = await db.vatRate.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      rate: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });

  return sazby.map((sazba) => ({
    id: sazba.id,
    name: sazba.name,
    rate: cislo(sazba.rate),
    updatedAt: sazba.updatedAt,
    /** Kolik produktů je v téhle sazbě. */
    produktu: sazba._count.products,
  }));
}

/* ---------- Dashboard ---------- */

/**
 * Čísla za zvolené období.
 *
 * Rozsah, který smí člověk vidět, je **v dotazu** — obchodník dostane
 * součty jen ze svých klientů, manažer a administrátor za všechny
 * (security_warnings.md, pravidlo 5). Kdo si adresu vyťuká sám, dostane
 * přesně totéž, co v rozhraní.
 *
 * Hodnoty zakázek se počítají z ceníku, ne z kopie u případu — stejně
 * jako v `nactiObjednavky()` — a **vždycky bez DPH** (Jakub, 10. 9. 2026).
 * Ceník je celý v korunách (`MENA_CENIKU`),
 * takže se částky sčítají do jedné měny; kdyby někdy přibyl produkt
 * v jiné měně, musí se to tady rozdělit.
 */

/**
 * Jeden obchodní případ tak, jak ho potřebuje Dashboard. Držíme z něj co nejmíň.
 *
 * Brokera ani obchodníka, ke kterému případ patří, si odtud Dashboard
 * od 22. 9. 2026 nebere — bloky, které je ukazovaly, Jakub zrušil. Proto
 * z databáze nechodí ani napojení na tabulky brokerů a klientů.
 */
interface ObjednavkaProSoucet {
  createdAt: Date;
  status: OrderStatus;
  /** Součet cen objednaných produktů bez DPH. */
  hodnota: number;
}

async function objednavkyZaObdobi(
  viewer: Viewer,
  od: Date,
  doKdy: Date,
): Promise<ObjednavkaProSoucet[]> {
  const objednavky = await db.order.findMany({
    where: { AND: [viditelneObjednavky(viewer), { createdAt: { gte: od, lt: doKdy } }] },
    select: {
      createdAt: true,
      status: true,
      items: {
        select: {
          quantity: true,
          netPrice: true,
          vatPercent: true,
          product: { select: { netPrice: true } },
        },
      },
    },
  });

  return objednavky.map((objednavka) => ({
    createdAt: objednavka.createdAt,
    status: objednavka.status,
    hodnota: objednavka.items.reduce(
      (soucet, polozka) => soucet + polozka.quantity * cenaPolozkyBezDph(polozka),
      0,
    ),
  }));
}

interface HovorProSoucet {
  at: Date;
  outcome: CallOutcome;
}

async function hovoryZaObdobi(viewer: Viewer, od: Date, doKdy: Date): Promise<HovorProSoucet[]> {
  return db.call.findMany({
    where: { client: viditelniKlienti(viewer), at: { gte: od, lt: doKdy }, deletedAt: null },
    select: { at: true, outcome: true },
  });
}

/**
 * Tři čísla nahoře na Dashboardu. Počítají se stejně pro obě období, ať jdou srovnat.
 *
 * Čtvrtou dlaždicí bývali **brokeři na případech z období**. Jakub ji
 * 22. 9. 2026 zrušil ze stejného důvodu jako graf téhož jména: broker se
 * u obchodního případu nevede, odvozoval se přes klienta, takže to číslo
 * bylo nepřímé.
 */
export interface SouhrnObdobi {
  objednavky: number;
  /** Hodnota případů bez DPH. */
  hodnota: number;
  hovory: number;
}

function souhrn(objednavky: ObjednavkaProSoucet[], hovory: HovorProSoucet[]): SouhrnObdobi {
  return {
    objednavky: objednavky.length,
    hodnota: objednavky.reduce((soucet, objednavka) => soucet + objednavka.hodnota, 0),
    hovory: hovory.length,
  };
}

export interface DashboardData {
  soucasnost: SouhrnObdobi;
  /** Stejně dlouhý úsek těsně před obdobím — jen pro srovnání u dlaždic. */
  minulost: SouhrnObdobi;
  /** Vývoj v čase. Jeden bod na den, týden nebo měsíc podle délky období. */
  vyvoj: { klic: string; popisek: string; hodnota: number; objednavky: number; hovory: number }[];
  hovoryPodleVysledku: { outcome: CallOutcome; label: string; pocet: number }[];
  objednavkyPodleStavu: { status: OrderStatus; label: string; pocet: number; hodnota: number }[];
  /** Klienti založení v období podle toho, odkud se o nás dozvěděli. */
  podleZdroje: { label: string; pocet: number }[];
}

export async function nactiDashboard(viewer: Viewer, obdobi: Obdobi): Promise<DashboardData> {
  const krok = krokProObdobi(obdobi.dnu);

  const [objednavky, hovory, minuleObjednavky, minuleHovory, noviKlienti, zdroje] =
    await Promise.all([
      objednavkyZaObdobi(viewer, obdobi.od, obdobi.do),
      hovoryZaObdobi(viewer, obdobi.od, obdobi.do),
      objednavkyZaObdobi(viewer, obdobi.predchoziOd, obdobi.predchoziDo),
      hovoryZaObdobi(viewer, obdobi.predchoziOd, obdobi.predchoziDo),
      // Noví klienti podle zdroje — v rozsahu role, stejně jako všechno ostatní.
      db.client.groupBy({
        by: ["sourceId"],
        where: {
          AND: [viditelniKlienti(viewer), { createdAt: { gte: obdobi.od, lt: obdobi.do } }],
        },
        _count: { _all: true },
      }),
      db.clientSource.findMany({ select: { id: true, name: true } }),
    ]);

  // --- Vývoj v čase -----------------------------------------------------
  // Sloupce se předpřipraví na celé období, i ty prázdné. Bez toho by
  // graf v tichém týdnu jen přeskočil a vypadalo by to, že se nic nestalo.
  const kbelik = new Map<string, { hodnota: number; objednavky: number; hovory: number }>();
  for (const zacatek of krokyObdobi(obdobi, krok)) {
    kbelik.set(jakoDen(zacatek), { hodnota: 0, objednavky: 0, hovory: 0 });
  }

  for (const objednavka of objednavky) {
    const klic = jakoDen(zacatekKroku(objednavka.createdAt, krok));
    const radek = kbelik.get(klic);
    if (!radek) continue;
    radek.hodnota += objednavka.hodnota;
    radek.objednavky += 1;
  }

  for (const hovor of hovory) {
    const klic = jakoDen(zacatekKroku(hovor.at, krok));
    const radek = kbelik.get(klic);
    if (radek) radek.hovory += 1;
  }

  const vyvoj = [...kbelik.entries()].map(([klic, radek]) => ({
    klic,
    popisek: popisekKroku(klic, krok),
    ...radek,
  }));

  // --- Rozpady ----------------------------------------------------------
  const hovoryPodleVysledku = CALL_OUTCOMES.map((vysledek) => ({
    outcome: vysledek,
    label: OUTCOME_LABEL[vysledek],
    pocet: hovory.filter((hovor) => hovor.outcome === vysledek).length,
  }));

  const objednavkyPodleStavu = ORDER_STATUSES.map((stav) => {
    const vlastni = objednavky.filter((objednavka) => objednavka.status === stav.id);
    return {
      status: stav.id,
      label: stav.label,
      pocet: vlastni.length,
      hodnota: vlastni.reduce((soucet, objednavka) => soucet + objednavka.hodnota, 0),
    };
  });

  return {
    soucasnost: souhrn(objednavky, hovory),
    minulost: souhrn(minuleObjednavky, minuleHovory),
    vyvoj,
    hovoryPodleVysledku,
    objednavkyPodleStavu,
    podleZdroje: noviKlienti
      .map((skupina) => ({
        label: zdroje.find((zdroj) => zdroj.id === skupina.sourceId)?.name ?? "Neznámý zdroj",
        pocet: skupina._count._all,
      }))
      .sort((a, b) => b.pocet - a.pocet || a.label.localeCompare(b.label, "cs")),
  };
}

/* ---------- Správa ---------- */

/**
 * Tým, jak se ukazuje ve Správě.
 *
 * Účty v koši (`deletedAt`) tu nejsou — jsou vidět jen v samotném koši.
 * Řádek jim v databázi zůstává, aby jejich klienti, hovory i auditní
 * stopa měly na koho ukazovat.
 */
export async function nactiUzivatele() {
  return db.user.findMany({
    where: { deletedAt: null },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true },
  });
}

/**
 * Brokeři k výběru a k zobrazení.
 *
 * Ti v koši (`deletedAt`) se nenabízejí nikde — jsou vidět jen v samotném
 * koši ve Správě. Řádek v databázi jim zůstává, aby se portfolia klientů
 * pořád měla na co odkazovat.
 */
export async function nactiBrokery() {
  return db.broker.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
}

/**
 * Lidé, kterým se dá přiřadit klient.
 *
 * Aktivní uživatelé bez ohledu na roli — klienta může vést i manažer.
 * Vrací jen jméno a id; nic dalšího formulář nepotřebuje.
 */
/** Komu jde přiřadit klienta — jen činní kolegové, ne odložení ani zablokovaní. */
export async function nactiPrirazitelne() {
  return db.user.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/* ---------- Objednávky ---------- */

/**
 * Které objednávky smí daná role vidět.
 *
 * Odvozuje se od klienta, ke kterému objednávka patří: obchodník tedy
 * vidí objednávky svých klientů, manažer a administrátor všechny (Jakub,
 * 8. 9. 2026, potvrzeno 22. 9. 2026 při přestavbě na objednávky).
 * Objednávka u klienta v koši se nikde neukáže — `viditelniKlienti()`
 * odložené klienty nepouští dál.
 */
export function viditelneObjednavky(viewer: Viewer): Prisma.OrderWhereInput {
  return { deletedAt: null, client: viditelniKlienti(viewer) };
}

/** Co si člověk vyplnil ve filtrech nad objednávkami. */
export interface FiltrObjednavek {
  /** Název objednávky, jméno klienta nebo název objednaného produktu. */
  hledat?: string;
  stav?: OrderStatus;
  // Filtr podle přístupu do programu zanikl 23. 9. 2026 — přístup je
  // od té doby u klienta, ne u objednávky.
  /** Objednávky jednoho klienta — používá se na jeho kartě. */
  klientId?: string;
  /** Čas objednávky od (včetně) — začátek dne, měsíce nebo roku v Praze. */
  od?: Date;
  /** Čas objednávky do (bez) — začátek následujícího dne, měsíce nebo roku. */
  do?: Date;
}

/**
 * Filtry přeložené do podmínek dotazu.
 *
 * Stejně jako u klientů platí, že **filtr rozsah nikdy nerozšíří, jen
 * zúží** — skládá se s `viditelneObjednavky()` přes `AND`. Kdyby si někdo
 * do adresy dopsal cizího klienta, dostane průnik s tím, co jeho role
 * vidí, tedy prázdno.
 */
async function podleFiltruObjednavek(filtr: FiltrObjednavek): Promise<Prisma.OrderWhereInput[]> {
  const podminky: Prisma.OrderWhereInput[] = [];

  const hledat = filtr.hledat?.trim();
  if (hledat) {
    podminky.push({
      OR: [
        // Číslo objednávky (Jakub, 24. 9. 2026) — jde hledat i jeho částí.
        { number: { contains: hledat } },
        { name: { contains: hledat, mode: "insensitive" } },
        // Klient (jméno, e-mail) a produkt bez ohledu na diakritiku
        // (Jakub, 25. 9. 2026) — viz `src/lib/hledani.ts`.
        { clientId: { in: await klientiPodleTextu(hledat) } },
        { items: { some: { productId: { in: await produktyPodleTextu(hledat) } } } },
      ],
    });
  }

  if (filtr.stav) podminky.push({ status: filtr.stav });
  if (filtr.klientId) podminky.push({ clientId: filtr.klientId });
  // Čas objednávky je `createdAt` — kdy přišla, ne kdy se zaplatila.
  if (filtr.od) podminky.push({ createdAt: { gte: filtr.od } });
  if (filtr.do) podminky.push({ createdAt: { lt: filtr.do } });

  return podminky;
}

/**
 * Roky, ze kterých jsou objednávky — pro výběr ve filtru. Od roku nejstarší
 * objednávky po letošek, nejnovější první; bez objednávek jen letošek.
 */
export async function nactiRokyObjednavek(viewer: Viewer): Promise<number[]> {
  const nejstarsi = await db.order.findFirst({
    where: viditelneObjednavky(viewer),
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const letos = dnesVPraze().rok;
  const prvni = nejstarsi
    ? Math.min(Number(jakoDen(nejstarsi.createdAt).slice(0, 4)), letos)
    : letos;

  return Array.from({ length: letos - prvni + 1 }, (_, index) => letos - index);
}

/** Jedna objednávka tak, jak ji potřebuje tabulka i karta klienta. */
export interface ObjednavkaKZobrazeni {
  id: string;
  /** Číslo objednávky `RRRR-NNNN` — v CRM ji označuje všude (Jakub, 24. 9. 2026). */
  number: string;
  /** Název z Landing Page. Od 24. 9. 2026 se nezobrazuje, jen se podle něj hledá. */
  name: string;
  status: OrderStatus;
  currency: string;
  note: string | null;
  clientId: string;
  clientName: string;
  /** Součet cen objednaných produktů **bez DPH**. Peníze se všude počítají bez daně. */
  hodnota: number;
  /** Tentýž součet včetně DPH — tak, kolik klient zaplatí. */
  hodnotaSDph: number;
  produkty: {
    id: string;
    productId: string;
    name: string;
    kind: ProductKind;
    quantity: number;
    /** Cena za kus podle ceníku. */
    cenaSDph: number;
    cenaBezDph: number;
  }[];
  /** Kdy klient objednávku uhradil. Podle něj se počítají tržby v Cílech. */
  paidAt: Date | null;
  /** Čas objednávky — kdy ji klient vytvořil. V tabulce se ukazuje i s časem. */
  createdAt: Date;
  updatedAt: Date;
}

export async function nactiObjednavky(
  viewer: Viewer,
  filtr: FiltrObjednavek = {},
): Promise<ObjednavkaKZobrazeni[]> {
  const objednavky = await db.order.findMany({
    where: { AND: [viditelneObjednavky(viewer), ...(await podleFiltruObjednavek(filtr))] },
    // Nejnovější objednávka nahoře. Řadí se podle času objednávky, ne
    // podle poslední změny — u objednávky z Landing Page je podstatné,
    // kdy přišla, ne kdy jí někdo přepnul stav.
    orderBy: [{ createdAt: "desc" }],
    include: {
      client: { select: { id: true, name: true } },
      items: {
        orderBy: { product: { name: "asc" } },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              kind: true,
              netPrice: true,
              vatRate: { select: { rate: true } },
            },
          },
        },
      },
    },
  });

  return objednavky.map((objednavka) => {
    // Cena ze chvíle objednávky (`order_items.netPrice`, od 30. 9. 2026) —
    // změna ceníku staré objednávky nepřepíše. Do té doby z ceníku.
    const produkty = objednavka.items.map((polozka) => ({
      id: polozka.id,
      productId: polozka.product.id,
      name: polozka.product.name,
      kind: polozka.product.kind,
      quantity: polozka.quantity,
      cenaBezDph: cenaPolozkyBezDph(polozka),
      // Každý produkt svou sazbou — v jedné objednávce může být kurz
      // v základní i konzultace ve snížené.
      cenaSDph: cenaPolozkySDph(polozka),
    }));

    return {
      id: objednavka.id,
      number: objednavka.number,
      name: objednavka.name,
      status: objednavka.status,
      currency: objednavka.currency,
      note: objednavka.note,
      clientId: objednavka.client.id,
      clientName: objednavka.client.name,
      hodnota: produkty.reduce((soucet, p) => soucet + p.quantity * p.cenaBezDph, 0),
      hodnotaSDph: produkty.reduce((soucet, p) => soucet + p.quantity * p.cenaSDph, 0),
      produkty,
      paidAt: objednavka.paidAt,
      createdAt: objednavka.createdAt,
      updatedAt: objednavka.updatedAt,
    };
  });
}

/**
 * Produkty, které se dají do obchodního případu vybrat.
 *
 * Jen ty v prodeji — do nové zakázky nemá smysl nabízet, co se už
 * neprodává. U případu, kde takový produkt zůstal z dřívějška, se
 * dál zobrazuje.
 */
export async function nactiProduktyProVyber() {
  const produkty = await db.product.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      netPrice: true,
      currency: true,
      vatRate: { select: { rate: true } },
    },
  });

  return produkty.map((produkt) => ({
    id: produkt.id,
    name: produkt.name,
    kind: produkt.kind,
    currency: produkt.currency,
    cenaBezDph: cislo(produkt.netPrice),
    cenaSDph: sDph(cislo(produkt.netPrice), cislo(produkt.vatRate.rate)),
  }));
}

/**
 * Klienti, ke kterým smí daná role případ přiřadit.
 *
 * Je to tentýž rozsah jako u čtení — obchodník tedy nezaloží případ
 * cizímu klientovi. Serverová akce si klienta stejně ověřuje znovu,
 * tohle je jen naplnění výběru ve formuláři.
 */
export async function nactiKlientyProVyber(viewer: Viewer) {
  return db.client.findMany({
    where: viditelniKlienti(viewer),
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/* ---------- Hovory ---------- */

/** Jeden řádek tabulky hovorů. */
export interface HovorKZobrazeni {
  id: string;
  at: Date;
  durationMin: number;
  outcome: CallOutcome;
  note: string;
  /** Kdo hovor zapsal. Podle toho se rozhoduje, kdo smí přepsat poznámku. */
  userId: string;
  userName: string;
  clientId: string;
  clientName: string;
  /** Případ, kterého se hovor týkal. Odložený případ se neukazuje. */
  orderId: string | null;
  /** Číslo objednávky (od 24. 9. 2026 místo názvu). */
  orderNumber: string | null;
  productName: string | null;
}

/** Co si člověk vyplnil ve filtrech nad hovory. */
export interface FiltrHovoru {
  /** Jméno klienta, název objednávky nebo text poznámky. */
  hledat?: string;
  vysledek?: CallOutcome;
  /** Hovory jednoho člověka — podle toho, **kdo je zapsal**. */
  uzivatelId?: string;
  /** Rozsah dat, oboje včetně. Přichází z polí typu datum. */
  od?: Date;
  do?: Date;
}

/**
 * Filtry přeložené do podmínek dotazu.
 *
 * **Filtr nikdy rozsah nerozšíří, jen zúží** — skládá se s podmínkou
 * viditelnosti přes `AND`.
 */
function podleFiltruHovoru(filtr: FiltrHovoru): Prisma.CallWhereInput[] {
  const podminky: Prisma.CallWhereInput[] = [];

  const hledat = filtr.hledat?.trim();
  if (hledat) {
    // Prisma skládá dotaz parametrizovaně, řetězec se nikam nevlepuje
    // (security_warnings.md, pravidlo 11).
    podminky.push({
      OR: [
        { client: { name: { contains: hledat, mode: "insensitive" } } },
        { order: { name: { contains: hledat, mode: "insensitive" } } },
        { note: { contains: hledat, mode: "insensitive" } },
      ],
    });
  }

  if (filtr.vysledek) podminky.push({ outcome: filtr.vysledek });

  // Kdo hovor zapsal. Je to autorství, ne vlastnictví klienta —
  // filtr proto zůstal i potom, co se klienti přestali přiřazovat.
  if (filtr.uzivatelId) podminky.push({ userId: filtr.uzivatelId });

  if (filtr.od) podminky.push({ at: { gte: filtr.od } });
  if (filtr.do) podminky.push({ at: { lt: filtr.do } });

  return podminky;
}

/**
 * Hovory pro obrazovku Hovory.
 *
 * **Omezení je v dotazu:** obchodník dostane hovory jen u klientů, které
 * má přiřazené, manažer a administrátor všechny (Jakub, 9. 9. 2026).
 * Hovory v koši se nezobrazují nikde kromě Smazaných.
 *
 * Tentýž dotaz plní tabulku i export do CSV — soubor tak nikdy neobsahuje
 * víc, než co má člověk na obrazovce.
 */
export async function nactiHovory(
  viewer: Viewer,
  filtr: FiltrHovoru = {},
): Promise<HovorKZobrazeni[]> {
  const hovory = await db.call.findMany({
    where: {
      AND: [{ deletedAt: null, client: viditelniKlienti(viewer) }, ...podleFiltruHovoru(filtr)],
    },
    orderBy: { at: "desc" },
    select: {
      id: true,
      at: true,
      durationMin: true,
      outcome: true,
      note: true,
      userId: true,
      user: { select: { name: true } },
      client: { select: { id: true, name: true } },
      order: { select: { id: true, number: true, deletedAt: true } },
      interestProduct: { select: { name: true } },
    },
  });

  return hovory.map((hovor) => ({
    id: hovor.id,
    at: hovor.at,
    durationMin: hovor.durationMin,
    outcome: hovor.outcome,
    note: hovor.note,
    userId: hovor.userId,
    userName: hovor.user.name,
    clientId: hovor.client.id,
    clientName: hovor.client.name,
    // Případ odložený do koše se nikde nezobrazuje. Vazba v databázi
    // zůstává, takže se po obnovení případu zase objeví.
    orderId: hovor.order && !hovor.order.deletedAt ? hovor.order.id : null,
    orderNumber: hovor.order && !hovor.order.deletedAt ? hovor.order.number : null,
    productName: hovor.interestProduct?.name ?? null,
  }));
}
