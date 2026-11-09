import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Základní ukázková data — tři klienti, produkty, objednávky, úkoly.
 *
 * VŠECHNA DATA JSOU VYMYŠLENÁ. Nikdy sem nekopíruj výřez z ostrých dat —
 * repozitář je sdílený a jména, e-maily ani objednávky skutečných klientů
 * do něj nepatří (viz security_warnings.md, pravidlo 8).
 *
 * Plní je `npm run db:seed` (vývoj a testy, `prisma/seed.ts`) a noční
 * obnova ukázky (`src/lib/ukazka-obnova.ts`), která na ně přidá bohatší
 * obsah. **Testy na těchhle datech stojí** — co tu změníš, zkontroluj
 * i v `e2e/`.
 *
 * Psané přes upsert, takže se dají pustit opakovaně bez duplicit.
 */
export async function naplnZakladniData(prisma: PrismaClient) {
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
      createdAt: new Date("2026-08-21T11:40:00Z"),
      lastContactAt: null,
    },
  });

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

  // --- Šablony e-mailů z karty klienta (5D, 5. 11. 2026) ----------------
  const sablonyEmailu = [
    {
      id: "sablona-prodlouzeni",
      name: "Připomínka prodloužení",
      subject: "Vaše členství brzy končí",
      body: "Dobrý den,\n\nvaše členství v Klubu BSM brzy končí. Pokud chcete pokračovat, prodloužení najdete v klientské části v sekci Koupit.\n\nS jakýmkoli dotazem stačí odpovědět na tento e-mail.",
    },
    {
      id: "sablona-uvitani",
      name: "Uvítání nového člena",
      subject: "Vítejte v Klubu BSM, {jmeno}",
      body: "Dobrý den,\n\nvítejte mezi členy Klubu BSM. V klientské části najdete kurzy, webináře a materiály ke stažení.\n\nTěšíme se na spolupráci.",
    },
  ];
  for (const { id, ...sablona } of sablonyEmailu) {
    await prisma.emailTemplate.upsert({ where: { id }, update: {}, create: { id, ...sablona } });
  }

  return {
    uzivatele: { petra, marek, admin },
    klienti: { novak, maresova, benes },
    idProduktu,
    zdrojKlienta,
  };
}
