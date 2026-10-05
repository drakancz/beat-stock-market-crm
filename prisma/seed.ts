import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Naplnění databáze ukázkovými daty.
 *
 * VŠECHNA DATA JSOU VYMYŠLENÁ. Nikdy sem nekopíruj výřez z ostrých dat —
 * repozitář je sdílený a jména, e-maily ani portfolia skutečných klientů
 * do něj nepatří (viz security_warnings.md, pravidlo 8).
 *
 * Seed je psaný přes upsert, takže se dá pustit opakovaně, aniž by
 * vznikaly duplicity.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Chybí proměnná DATABASE_URL — seed se nemá kam připojit.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // --- Uživatelé --------------------------------------------------------
  const petra = await prisma.user.upsert({
    where: { email: "petra.dvorakova@beatstockmarket.test" },
    update: {},
    create: {
      name: "Petra Dvořáková",
      firstName: "Petra",
      lastName: "Dvořáková",
      email: "petra.dvorakova@beatstockmarket.test",
      role: "UZIVATEL",
    },
  });

  const marek = await prisma.user.upsert({
    where: { email: "marek.hlavacek@beatstockmarket.test" },
    update: {},
    create: {
      name: "Marek Hlaváček",
      firstName: "Marek",
      lastName: "Hlaváček",
      email: "marek.hlavacek@beatstockmarket.test",
      role: "UZIVATEL",
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@beatstockmarket.test" },
    update: {},
    create: {
      name: "Jakub Kostan",
      firstName: "Jakub",
      lastName: "Kostan",
      email: "admin@beatstockmarket.test",
      role: "ADMINISTRATOR",
    },
  });

  // --- Brokeři ----------------------------------------------------------
  const brokeri = [
    { id: "trading212", name: "Trading 212", autoConnect: "ANO" as const },
    { id: "ibkr", name: "Interactive Brokers", autoConnect: "ANO" as const },
    { id: "xtb", name: "XTB", autoConnect: "PRAVDEPODOBNE" as const },
    { id: "freedom24", name: "Freedom24", autoConnect: "PRAVDEPODOBNE" as const },
    { id: "etoro", name: "eToro", autoConnect: "ZATIM_NE" as const },
  ];

  for (const broker of brokeri) {
    await prisma.broker.upsert({
      where: { id: broker.id },
      update: { name: broker.name, autoConnect: broker.autoConnect },
      create: broker,
    });
  }

  // --- Produkty ---------------------------------------------------------
  // Ceny bez DPH, všechny v základní sazbě. Sazby zakládá migrace.
  const zakladni = "zakladni";
  const produkty = [
    { name: "Kurz Základy investování", kind: "KURZ" as const, netPrice: 6500, active: true },
    { name: "Kurz Technická analýza", kind: "KURZ" as const, netPrice: 10650, active: true },
    { name: "Členství Klub BSM — rok", kind: "CLENSTVI" as const, netPrice: 16450, active: true },
    { name: "Konzultace 1:1 (60 min)", kind: "KONZULTACE" as const, netPrice: 2900, active: true },
    { name: "Kurz Dividendové portfolio", kind: "KURZ" as const, netPrice: 8200, active: false },
  ].map((produkt) => ({ ...produkt, vatRateId: zakladni }));

  const ulozeneProdukty = new Map<string, string>();
  for (const produkt of produkty) {
    const existujici = await prisma.product.findFirst({ where: { name: produkt.name } });
    const ulozeny = existujici
      ? await prisma.product.update({
          where: { id: existujici.id },
          data: { ...produkt, currency: "CZK" },
        })
      : await prisma.product.create({ data: { ...produkt, currency: "CZK" } });
    ulozeneProdukty.set(produkt.name, ulozeny.id);
  }

  const idProduktu = (nazev: string) => ulozeneProdukty.get(nazev) ?? null;

  // --- Zdroje klientů ---------------------------------------------------
  // Seznam spravuje administrátor v Nastavení; u klienta se jen vybírá.
  const zdroje = [
    "Webinář — Jak číst akciový trh",
    "Doporučení od klienta",
    "Newsletter — SmartEmailing",
  ];

  // Zdroj „Landing Page" zakládá migrace s pevným id — objednávky i leady
  // z webu ho dostanou vždycky (`ZDROJ_LANDING_PAGE` v `src/lib/leady.ts`).
  await prisma.clientSource.upsert({
    where: { id: "landing-page" },
    update: {},
    create: { id: "landing-page", name: "Landing Page", order: 0 },
  });

  const idZdroju = new Map<string, string>();
  for (const [poradi, nazev] of zdroje.entries()) {
    const zdroj =
      (await prisma.clientSource.findFirst({ where: { name: nazev } })) ??
      (await prisma.clientSource.create({ data: { name: nazev, order: poradi + 1 } }));
    idZdroju.set(nazev, zdroj.id);
  }

  const zdrojKlienta = (nazev: string) => {
    const id = idZdroju.get(nazev);
    if (!id) throw new Error(`Zdroj ${nazev} v seedu chybí.`);
    return id;
  };

  // --- Klienti ----------------------------------------------------------
  const novak = await prisma.client.upsert({
    where: { email: "jan.novak@example.test" },
    update: {},
    create: {
      name: "Jan Novák",
      email: "jan.novak@example.test",
      phone: "+420 602 118 447",
      sourceId: zdrojKlienta("Webinář — Jak číst akciový trh"),
      stage: "AKTIVNE_OBCHODUJE",
      // Zaplatil a přístup do klubu má zařízený.
      programAccess: "POVOLEN",
      consentMarketingAt: new Date("2026-04-12T09:00:00Z"),
      consentRecordingAt: new Date("2026-04-12T09:00:00Z"),
      createdAt: new Date("2026-04-12T09:00:00Z"),
      lastContactAt: new Date("2026-08-27T10:20:00Z"),
    },
  });

  const maresova = await prisma.client.upsert({
    where: { email: "lucie.maresova@example.test" },
    update: {},
    create: {
      name: "Lucie Marešová",
      email: "lucie.maresova@example.test",
      phone: "+420 731 904 265",
      sourceId: zdrojKlienta("Doporučení od klienta"),
      stage: "MA_ZAJEM",
      consentMarketingAt: new Date("2026-07-30T14:00:00Z"),
      consentRecordingAt: null,
      createdAt: new Date("2026-07-30T14:00:00Z"),
      lastContactAt: new Date("2026-08-29T15:45:00Z"),
    },
  });

  const benes = await prisma.client.upsert({
    where: { email: "tomas.benes@example.test" },
    update: {},
    create: {
      name: "Tomáš Beneš",
      email: "tomas.benes@example.test",
      phone: "+420 777 312 088",
      sourceId: zdrojKlienta("Newsletter — SmartEmailing"),
      stage: "KONTAKTOVAN",
      consentMarketingAt: null,
      consentRecordingAt: null,
      createdAt: new Date("2026-08-21T11:40:00Z"),
      lastContactAt: null,
    },
  });

  // --- Portfolia a pozice ----------------------------------------------
  const portfolia = [
    {
      clientId: novak.id,
      brokerId: "trading212",
      source: "KLIC" as const,
      currency: "USD",
      invested: 18400,
      value: 21327.5,
      lastSyncAt: new Date("2026-08-30T22:10:00Z"),
      pozice: [
        { ticker: "AAPL", name: "Apple", quantity: 24, averagePrice: 198.4, currentPrice: 223.1 },
        {
          ticker: "MSFT",
          name: "Microsoft",
          quantity: 12,
          averagePrice: 402.15,
          currentPrice: 441.8,
        },
        { ticker: "NVDA", name: "NVIDIA", quantity: 30, averagePrice: 121.05, currentPrice: 118.4 },
      ],
    },
    {
      clientId: novak.id,
      brokerId: "xtb",
      source: "RUCNE" as const,
      currency: "USD",
      invested: 6200,
      value: 5844.2,
      lastSyncAt: null,
      pozice: [
        { ticker: "TSLA", name: "Tesla", quantity: 15, averagePrice: 268.9, currentPrice: 241.3 },
        { ticker: "KO", name: "Coca-Cola", quantity: 40, averagePrice: 61.2, currentPrice: 65.75 },
      ],
    },
    {
      clientId: maresova.id,
      brokerId: "trading212",
      source: "KLIC" as const,
      currency: "EUR",
      invested: 3000,
      value: 3182.4,
      lastSyncAt: new Date("2026-08-30T22:10:00Z"),
      pozice: [
        {
          ticker: "ASML",
          name: "ASML Holding",
          quantity: 3,
          averagePrice: 682.0,
          currentPrice: 724.5,
        },
      ],
    },
  ];

  for (const { pozice, ...portfolio } of portfolia) {
    const ulozene = await prisma.portfolio.upsert({
      where: { clientId_brokerId: { clientId: portfolio.clientId, brokerId: portfolio.brokerId } },
      update: portfolio,
      create: portfolio,
    });

    for (const pozicka of pozice) {
      await prisma.position.upsert({
        where: { portfolioId_ticker: { portfolioId: ulozene.id, ticker: pozicka.ticker } },
        update: pozicka,
        create: { ...pozicka, portfolioId: ulozene.id },
      });
    }
  }

  // --- Hovory -----------------------------------------------------------
  const hovory = [
    {
      clientId: novak.id,
      userId: petra.id,
      at: new Date("2026-08-27T10:20:00Z"),
      durationMin: 14,
      outcome: "DOVOLANO" as const,
      note: "Prošli jsme výsledky portfolia. Zajímá ho rozšíření o dividendové tituly.",
      interestProductId: idProduktu("Kurz Dividendové portfolio"),
    },
    {
      clientId: maresova.id,
      userId: petra.id,
      at: new Date("2026-08-29T15:45:00Z"),
      durationMin: 9,
      outcome: "SCHUZKA" as const,
      note: "Domluvena online schůzka na 3. 9. Chce projít, jak si založit účet u brokera.",
      interestProductId: idProduktu("Kurz Základy investování"),
    },
    {
      clientId: maresova.id,
      userId: petra.id,
      at: new Date("2026-08-25T09:05:00Z"),
      durationMin: 2,
      outcome: "NEDOVOLANO" as const,
      note: "Nezvedá, zkusím odpoledne.",
      interestProductId: null,
    },
    {
      clientId: benes.id,
      userId: marek.id,
      at: new Date("2026-08-22T16:30:00Z"),
      durationMin: 6,
      outcome: "DOVOLANO" as const,
      note: "Zatím jen sbírá informace. Poslat materiály ke kurzu.",
      interestProductId: idProduktu("Kurz Základy investování"),
    },
  ];

  for (const hovor of hovory) {
    const existuje = await prisma.call.findFirst({
      where: { clientId: hovor.clientId, at: hovor.at },
    });
    if (!existuje) await prisma.call.create({ data: hovor });
  }

  // --- Úkoly ------------------------------------------------------------
  const ukoly = [
    {
      clientId: maresova.id,
      userId: petra.id,
      title: "Online schůzka — založení účtu u brokera",
      dueAt: new Date("2026-09-03T09:00:00Z"),
      doneAt: null,
    },
    {
      clientId: novak.id,
      userId: petra.id,
      title: "Zavolat ohledně dividendového kurzu",
      dueAt: new Date("2026-08-31T09:00:00Z"),
      doneAt: null,
    },
    {
      clientId: benes.id,
      userId: marek.id,
      title: "Poslat materiály ke kurzu Základy investování",
      dueAt: new Date("2026-08-28T09:00:00Z"),
      doneAt: null,
    },
    {
      clientId: novak.id,
      userId: petra.id,
      title: "Ověřit propojení Trading 212",
      dueAt: new Date("2026-08-26T09:00:00Z"),
      doneAt: new Date("2026-08-26T13:10:00Z"),
    },
  ];

  for (const ukol of ukoly) {
    const existuje = await prisma.task.findFirst({
      where: { clientId: ukol.clientId, title: ukol.title },
    });
    if (!existuje) await prisma.task.create({ data: ukol });
  }

  // --- Aktivity ---------------------------------------------------------
  const aktivity = [
    {
      clientId: novak.id,
      at: new Date("2026-08-30T19:02:00Z"),
      source: "KLIENTSKA_CAST" as const,
      description: "Přidal AAPL do watchlistu",
    },
    {
      clientId: novak.id,
      at: new Date("2026-08-28T18:30:00Z"),
      source: "WEBINARJAM" as const,
      description: "Byl na webináři Dividendy 2026 (42 minut)",
    },
    {
      clientId: maresova.id,
      at: new Date("2026-08-29T08:14:00Z"),
      source: "SMARTEMAILING" as const,
      description: "Otevřel e-mail Týdenní přehled trhu",
    },
    {
      clientId: benes.id,
      at: new Date("2026-08-21T11:40:00Z"),
      source: "SMARTEMAILING" as const,
      description: "Přihlásil se k odběru newsletteru",
    },
  ];

  for (const aktivita of aktivity) {
    const existuje = await prisma.activity.findFirst({
      where: { clientId: aktivita.clientId, at: aktivita.at },
    });
    if (!existuje) await prisma.activity.create({ data: aktivita });
  }

  // --- Objednávky -------------------------------------------------------
  // Co si klienti koupili. Objednávky v ostrém provozu přicházejí z Landing
  // Page (`POST /api/objednavky`); v seedu se zapisují přímo do databáze,
  // aby bylo co zkoušet. Data jsou vymyšlená (security_warnings.md,
  // pravidlo 8).
  const objednavky = [
    {
      name: "Členství Klub BSM — rok + Konzultace 1:1 (60 min)",
      clientId: novak.id,
      status: "ZAPLACENO" as const,
      note: "Zaplaceno kartou, přístup do klubu zařízen.",
      produkty: [
        { nazev: "Členství Klub BSM — rok", kusu: 1 },
        { nazev: "Konzultace 1:1 (60 min)", kusu: 2 },
      ],
    },
    {
      name: "Kurz Základy investování",
      clientId: maresova.id,
      status: "NEZAPLACENO" as const,
      note: "Ptala se na splátky, platbu zatím neposlala.",
      produkty: [{ nazev: "Kurz Základy investování", kusu: 1 }],
    },
    {
      name: "Kurz Technická analýza",
      clientId: benes.id,
      // Zaplaceno, ale přístup nikdo nezařídil — přesně ten stav, na který
      // seznam klientů upozorňuje (přístup je od 23. 9. 2026 u klienta).
      status: "ZAPLACENO" as const,
      note: "Platba dorazila, přístup do kurzu ještě čeká.",
      produkty: [{ nazev: "Kurz Technická analýza", kusu: 1 }],
    },
    {
      name: "Členství Klub BSM — rok",
      clientId: novak.id,
      status: "NOVA" as const,
      note: "Právě objednáno, čeká na platbu přes bránu.",
      produkty: [{ nazev: "Členství Klub BSM — rok", kusu: 1 }],
    },
  ];

  for (const { produkty: polozky, ...objednavka } of objednavky) {
    const existuje = await prisma.order.findFirst({
      where: { name: objednavka.name, clientId: objednavka.clientId },
    });
    if (existuje) continue;

    // Objednávka ukazuje na produkt v ceníku; kdyby v něm produkt nebyl,
    // řádek se přeskočí, ať se seed nezasekne na chybějící vazbě.
    const items = polozky
      .map((polozka) => ({ productId: idProduktu(polozka.nazev), quantity: polozka.kusu }))
      .filter((polozka): polozka is { productId: string; quantity: number } =>
        Boolean(polozka.productId),
      );

    await prisma.order.create({
      data: {
        ...objednavka,
        currency: "CZK",
        paidAt: objednavka.status === "ZAPLACENO" ? new Date("2026-09-02T10:00:00Z") : null,
        items: { create: items },
      },
    });
  }

  const pocty = {
    uzivatelé: await prisma.user.count(),
    brokeři: await prisma.broker.count(),
    klienti: await prisma.client.count(),
    objednávky: await prisma.order.count(),
    portfolia: await prisma.portfolio.count(),
    pozice: await prisma.position.count(),
    produkty: await prisma.product.count(),
    hovory: await prisma.call.count(),
    úkoly: await prisma.task.count(),
    aktivity: await prisma.activity.count(),
  };

  console.log("Ukázková data nahrána:", pocty);
  console.log("Administrátor:", admin.email);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (chyba) => {
    console.error("Seed selhal:", chyba);
    await prisma.$disconnect();
    process.exit(1);
  });
