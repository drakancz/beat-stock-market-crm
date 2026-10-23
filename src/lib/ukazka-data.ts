import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { prepocitejOdmenu } from "@/lib/doporuceni";
import { vystavFakturu } from "@/lib/faktury/faktury";
import { zahesluj } from "@/lib/hesla";
import { opisDelkuPlatnosti, prepocitejPlatnost } from "@/lib/platnost";
import { UKAZKOVY_KLIENT, UKAZKOVY_TYM } from "@/lib/ukazka";
import { UKAZKOVE_CLANKY, UKAZKOVE_KURZY, UKAZKOVE_WEBINARE } from "@/lib/ukazka-obsah";
import { isoTyden } from "@/lib/vzdelavani/odznaky";
import { naplnZakladniData } from "@/lib/ukazka-zaklad";

/**
 * Data živé ukázky (Jakub, 22. 10. 2026) — body B, C a D.
 *
 * Na základní data (`ukazka-zaklad.ts`) přidá to, co z CRM dělá
 * přesvědčivou ukázku: zkušební účty, vymyšlenou firmu pro faktury,
 * klienty s objednávkami (členství i přes rok zpátky), štítky, poznámky,
 * úkoly, konzultace a celé vzdělávání. **Data jsou vymyšlená**
 * (security_warnings.md, pravidlo 8), data se počítají od dneška, aby
 * ukázka nestárla.
 *
 * Volá ji jen noční obnova (`ukazka-obnova.ts`) nad vyčištěnou databází,
 * proto se nic nehledá ani neslučuje. Zaplacení jde přes stejné funkce
 * jako v provozu (platnost, faktura), jen bez upozornění a webhooků —
 * ty by ukázka stejně nepustila ven.
 */

const DEN = 24 * 60 * 60 * 1000;

/** Okamžik `dni` dní od teď (záporné = v minulosti) v dané pražské hodině. */
function den(dni: number, hodina = 10): Date {
  const datum = new Date(Date.now() + dni * DEN);
  // Hodina zhruba v pražském čase (UTC+1 / +2); na minuty tu nezáleží.
  datum.setUTCHours(hodina - 1, 0, 0, 0);
  return datum;
}

/** Vymyšlená firma pro faktury a export do Pohody (bod D). IČO v ARES není. */
export const UKAZKOVA_FIRMA = {
  companyName: "Beat Stock Market (ukázka)",
  ico: "00000000",
  dic: "CZ00000000",
  address: "Ukázková 1, 110 00 Praha 1",
  bankAccount: "000000-0000000000/0000",
  vatPayer: true,
  contactEmail: "info@beatstockmarket.test",
  emailSenderName: "Beat Stock Market (ukázka)",
} as const;

/** Řádky, které jinak zakládají migrace — po vyčištění tabulek chybí. */
async function radkyZMigraci() {
  await db.vatRate.createMany({
    data: [
      { id: "zakladni", name: "Základní", rate: 21, order: 1 },
      { id: "snizena", name: "Snížená", rate: 12, order: 2 },
      { id: "nulova", name: "Nulová", rate: 0, order: 3 },
    ],
    skipDuplicates: true,
  });
  await db.companySettings.upsert({
    where: { id: "firma" },
    update: UKAZKOVA_FIRMA,
    create: { id: "firma", ...UKAZKOVA_FIRMA },
  });
  await db.automationRule.createMany({
    data: [
      { id: "nechodi-ukol", enabled: false },
      {
        id: "nechodi-zprava",
        enabled: false,
        messageTitle: "Chybíte nám",
        messageText:
          "Dobrý den, dlouho jsme vás v klientské části neviděli. Čekají na vás nové lekce a webináře — stačí se přihlásit a pokračovat tam, kde jste skončili.",
      },
      { id: "lekce-oznameni", enabled: false },
      { id: "zaplaceno-stitek", enabled: false },
    ],
    skipDuplicates: true,
  });
}

/** Zkušební člen týmu — administrátor bez Správy uživatelů (`src/lib/ukazka.ts`). */
async function ukazkovyClenTymu() {
  const data = {
    // „Vítej, Hoste!“ — sedí každému návštěvníkovi.
    name: "Host Ukázky",
    firstName: "Host",
    lastName: "Ukázky",
    vocative: "Hoste",
    role: "ADMINISTRATOR" as const,
    active: true,
    deletedAt: null,
    passwordHash: await zahesluj(UKAZKOVY_TYM.heslo),
    passwordSetAt: new Date(),
    // Návštěvníci se v noci odhlásí — obnova smazala data pod nimi.
    tokensValidFrom: new Date(),
    twoFactorEnabled: false,
  };
  const ucet = await db.user.upsert({
    where: { email: UKAZKOVY_TYM.email },
    update: data,
    create: { email: UKAZKOVY_TYM.email, ...data },
  });
  await db.twoFactor.deleteMany({ where: { userId: ucet.id } });
  return ucet;
}

interface NovyKlient {
  name: string;
  email: string;
  phone: string | null;
  zdroj: string;
  stage: "NOVY" | "KONTAKTOVAN" | "MA_ZAJEM" | "MA_UCET" | "AKTIVNE_OBCHODUJE" | "NEAKTIVNI";
  souhlas: boolean;
  predDny: number;
  stitky?: string[];
  poznamka?: string;
  /** Objednávky: názvy produktů, stav a před kolika dny. */
  objednavky?: {
    produkty: string[];
    stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO";
    predDny: number;
  }[];
}

const KLIENTI: NovyKlient[] = [
  {
    name: "Eva Malá",
    email: UKAZKOVY_KLIENT.email,
    phone: "+420 608 100 200",
    zdroj: "Landing Page",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 70,
    stitky: ["Klub"],
    poznamka: "Ukázkový klient — přes tenhle účet se návštěvníci dívají do klientské části.",
    objednavky: [
      { produkty: ["Kurz Základy investování"], stav: "ZAPLACENO", predDny: 65 },
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 40 },
      // Dvě konzultace: jedna už má termín, druhou si návštěvník vybere sám
      // (krok průvodce „Rezervace konzultace“).
      { produkty: ["Konzultace 1:1 (60 min)"], stav: "ZAPLACENO", predDny: 25 },
      { produkty: ["Konzultace 1:1 (60 min)"], stav: "ZAPLACENO", predDny: 6 },
      { produkty: ["Kurz Technická analýza"], stav: "NEZAPLACENO", predDny: 2 },
    ],
  },
  {
    name: "Ondřej Kratochvíl",
    email: "ondrej.kratochvil@example.test",
    phone: "+420 723 551 902",
    zdroj: "Webinář — Jak číst akciový trh",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 88,
    stitky: ["Klub", "VIP"],
    poznamka: "Chce si projít technickou analýzu před koncem roku.",
    objednavky: [
      {
        produkty: ["Členství Klub BSM — rok", "Konzultace 1:1 (60 min)"],
        stav: "ZAPLACENO",
        predDny: 85,
      },
      { produkty: ["Kurz Technická analýza"], stav: "ZAPLACENO", predDny: 30 },
    ],
  },
  {
    name: "Kateřina Veselá",
    email: "katerina.vesela@example.test",
    phone: "+420 776 203 418",
    zdroj: "Doporučení od klienta",
    stage: "MA_UCET",
    souhlas: true,
    predDny: 45,
    objednavky: [{ produkty: ["Kurz Základy investování"], stav: "ZAPLACENO", predDny: 44 }],
  },
  {
    name: "Petr Horák",
    email: "petr.horak@example.test",
    phone: null,
    zdroj: "Landing Page",
    stage: "MA_ZAJEM",
    souhlas: false,
    predDny: 12,
    stitky: ["Splátky"],
    poznamka: "Ptal se na rozložení platby, poslali jsme podmínky.",
    objednavky: [{ produkty: ["Členství Klub BSM — rok"], stav: "NEZAPLACENO", predDny: 11 }],
  },
  {
    name: "Jana Procházková",
    email: "jana.prochazkova@example.test",
    phone: "+420 604 887 120",
    zdroj: "Newsletter — SmartEmailing",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 80,
    stitky: ["Klub"],
    objednavky: [
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 78 },
      { produkty: ["Konzultace 1:1 (60 min)"], stav: "ZAPLACENO", predDny: 20 },
    ],
  },
  {
    name: "Martin Dvořák",
    email: "martin.dvorak@example.test",
    phone: "+420 731 004 556",
    zdroj: "Webinář — Jak číst akciový trh",
    stage: "KONTAKTOVAN",
    souhlas: true,
    predDny: 6,
    stitky: ["Webinář"],
  },
  {
    name: "Lenka Šimková",
    email: "lenka.simkova@example.test",
    phone: "+420 602 377 901",
    zdroj: "Landing Page",
    stage: "NOVY",
    souhlas: false,
    predDny: 1,
    objednavky: [{ produkty: ["Kurz Základy investování"], stav: "NOVA", predDny: 1 }],
  },
  {
    name: "Tomáš Černý",
    email: "tomas.cerny@example.test",
    phone: "+420 777 560 233",
    zdroj: "Doporučení od klienta",
    stage: "NEAKTIVNI",
    souhlas: true,
    predDny: 360,
    poznamka: "Členství mu brzy končí, zatím neodpověděl.",
    objednavky: [
      // Roční členství končí asi za dva týdny — sedí k poznámce i úkolu.
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 353 },
      { produkty: ["Kurz Technická analýza"], stav: "ZAPLACENO", predDny: 87 },
    ],
  },
  {
    name: "Barbora Němcová",
    email: "barbora.nemcova@example.test",
    phone: "+420 720 118 664",
    zdroj: "Webinář — Jak číst akciový trh",
    stage: "MA_UCET",
    souhlas: true,
    predDny: 25,
    stitky: ["Webinář"],
    objednavky: [
      {
        produkty: ["Kurz Základy investování", "Kurz Technická analýza"],
        stav: "ZAPLACENO",
        predDny: 24,
      },
    ],
  },
  {
    name: "Jakub Pokorný",
    email: "jakub.pokorny@example.test",
    phone: "+420 605 902 347",
    zdroj: "Newsletter — SmartEmailing",
    stage: "MA_ZAJEM",
    souhlas: true,
    predDny: 16,
    objednavky: [{ produkty: ["Konzultace 1:1 (60 min)"], stav: "NEZAPLACENO", predDny: 9 }],
  },
  {
    name: "Simona Králová",
    email: "simona.kralova@example.test",
    phone: "+420 739 441 085",
    zdroj: "Landing Page",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 58,
    stitky: ["Klub", "VIP"],
    objednavky: [
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 57 },
      { produkty: ["Kurz Základy investování"], stav: "ZAPLACENO", predDny: 15 },
    ],
  },
  {
    name: "Filip Růžička",
    email: "filip.ruzicka@example.test",
    phone: null,
    zdroj: "Landing Page",
    stage: "NOVY",
    souhlas: false,
    predDny: 3,
  },
  // Historie členství, ať čísla Členství na Dashboardu za 30 dní nejsou
  // nuly (Jakub, 23. 10. 2026). Členství je roční, zaplaceno = předDny − 1:
  // dva prodloužili, jeden odešel, u jednoho běží lhůta, dva jsou noví.
  {
    name: "Radek Svoboda",
    email: "radek.svoboda@example.test",
    phone: "+420 721 330 415",
    zdroj: "Landing Page",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 395,
    stitky: ["Klub"],
    objednavky: [
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 382 },
      // Prodloužil ještě před koncem.
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 20 },
    ],
  },
  {
    name: "Alena Kučerová",
    email: "alena.kucerova@example.test",
    phone: "+420 736 812 044",
    zdroj: "Newsletter — SmartEmailing",
    stage: "AKTIVNE_OBCHODUJE",
    souhlas: true,
    predDny: 380,
    stitky: ["Klub"],
    objednavky: [
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 372 },
      // Zaplatila pár dní po konci — ve lhůtě, počítá se jako prodloužení.
      { produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 4 },
    ],
  },
  {
    name: "Michal Zeman",
    email: "michal.zeman@example.test",
    phone: "+420 774 205 381",
    zdroj: "Webinář — Jak číst akciový trh",
    stage: "NEAKTIVNI",
    souhlas: true,
    predDny: 400,
    poznamka: "Členství neprodloužil, prý se vrátí po novém roce.",
    objednavky: [{ produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 390 }],
  },
  {
    name: "Hana Marková",
    email: "hana.markova@example.test",
    phone: "+420 608 447 129",
    zdroj: "Landing Page",
    stage: "MA_UCET",
    souhlas: true,
    predDny: 375,
    objednavky: [{ produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 371 }],
  },
  {
    name: "Veronika Šťastná",
    email: "veronika.stastna@example.test",
    phone: "+420 725 913 602",
    zdroj: "Doporučení od klienta",
    stage: "MA_UCET",
    souhlas: true,
    predDny: 14,
    stitky: ["Klub"],
    objednavky: [{ produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 10 }],
  },
  {
    name: "Lukáš Holub",
    email: "lukas.holub@example.test",
    phone: null,
    zdroj: "Webinář — Jak číst akciový trh",
    stage: "MA_UCET",
    souhlas: false,
    predDny: 25,
    stitky: ["Klub"],
    objednavky: [{ produkty: ["Členství Klub BSM — rok"], stav: "ZAPLACENO", predDny: 22 }],
  },
];

const STITKY: { name: string; color: "ZNACKA" | "ZELENA" | "JANTAR" | "ZAKLADNI" }[] = [
  { name: "Klub", color: "ZNACKA" },
  { name: "VIP", color: "ZELENA" },
  { name: "Splátky", color: "JANTAR" },
  { name: "Webinář", color: "ZAKLADNI" },
];

/** Naplní vyčištěnou databázi ukázkou. Vrací, kolik čeho vzniklo. */
export async function naplnUkazku() {
  await radkyZMigraci();
  const zaklad = await naplnZakladniData(db);
  const tym = await ukazkovyClenTymu();

  // Členství má roční platnost — bez ní by klientská část neměla Klub.
  const clenstvi = zaklad.idProduktu("Členství Klub BSM — rok");
  if (clenstvi) await db.product.update({ where: { id: clenstvi }, data: { validityMonths: 12 } });

  const produkty = new Map(
    (await db.product.findMany({ select: { id: true, name: true, netPrice: true } })).map((p) => [
      p.name,
      p,
    ]),
  );

  const stitky = new Map<string, string>();
  for (const stitek of STITKY) {
    stitky.set(stitek.name, (await db.clientTag.create({ data: stitek })).id);
  }

  const zaplacene: string[] = [];
  const idKlientu = new Map<string, string>();

  for (const k of KLIENTI) {
    const klient = await db.client.create({
      data: {
        name: k.name,
        email: k.email,
        phone: k.phone,
        sourceId: k.zdroj === "Landing Page" ? "landing-page" : zaklad.zdrojKlienta(k.zdroj),
        stage: k.stage,
        programAccess: k.stage === "AKTIVNE_OBCHODUJE" ? "POVOLEN" : "NEPOVOLEN",
        consentMarketingAt: k.souhlas ? den(-k.predDny) : null,
        createdAt: den(-k.predDny),
        lastContactAt: den(-Math.max(0, k.predDny - 3)),
      },
    });
    idKlientu.set(k.email, klient.id);

    for (const nazev of k.stitky ?? []) {
      await db.clientTagLink.create({
        data: { clientId: klient.id, tagId: stitky.get(nazev)!, addedById: tym.id },
      });
    }
    if (k.poznamka) {
      await db.clientNote.create({
        data: {
          clientId: klient.id,
          authorId: zaklad.uzivatele.petra.id,
          text: k.poznamka,
          createdAt: den(-k.predDny + 1),
        },
      });
    }

    for (const o of k.objednavky ?? []) {
      const polozky = o.produkty.map((nazev) => produkty.get(nazev)).filter((p) => p !== undefined);
      const objednavka = await db.order.create({
        data: {
          name: o.produkty.join(" + "),
          clientId: klient.id,
          status: o.stav,
          currency: "CZK",
          channel: k.email === UKAZKOVY_KLIENT.email ? "KLIENTSKA_CAST" : "LANDING_PAGE",
          createdAt: den(-o.predDny, 9),
          paidAt: o.stav === "ZAPLACENO" ? den(-o.predDny + 1, 11) : null,
          items: {
            create: polozky.map((p) => ({
              productId: p.id,
              quantity: 1,
              netPrice: p.netPrice,
              listNetPrice: p.netPrice,
              vatPercent: 21,
            })),
          },
        },
      });
      if (o.stav === "ZAPLACENO") {
        zaplacene.push(objednavka.id);
        await db.$transaction(async (tx) => {
          await opisDelkuPlatnosti(tx, objednavka.id, true);
          await prepocitejPlatnost(tx, klient.id);
        });
      }
    }
  }

  // Zaplacené objednávky ze základních dat (Jan Novák, Tomáš Beneš) —
  // seed jim platnost ani fakturu nedává.
  for (const o of await db.order.findMany({
    where: { status: "ZAPLACENO", id: { notIn: zaplacene } },
    select: { id: true, clientId: true },
  })) {
    zaplacene.push(o.id);
    await db.$transaction(async (tx) => {
      await opisDelkuPlatnosti(tx, o.id, true);
      await prepocitejPlatnost(tx, o.clientId);
    });
  }

  // Faktury přes stejnou funkci jako po zaplacení — čísla přidělí databáze.
  for (const id of zaplacene) await vystavFakturu(id, null);

  // --- Ukázkový klient: účet do klientské části -------------------------
  const evaId = idKlientu.get(UKAZKOVY_KLIENT.email)!;
  await db.clientAccount.create({
    data: {
      clientId: evaId,
      passwordHash: await zahesluj(UKAZKOVY_KLIENT.heslo),
      passwordSetAt: den(-60),
      invitedAt: den(-65),
      invitedById: tym.id,
      notificationsEnabled: false,
      lastLoginAt: den(-1),
      lastSeenAt: den(-1),
    },
  });
  await db.clientMessage.create({
    data: {
      clientId: evaId,
      authorId: zaklad.uzivatele.petra.id,
      text: "Dobrý den, děkujeme za přihlášku do Klubu. Ve čtvrtek je otevřený webinář — budeme rádi, když se připojíte.",
      delivery: "JEN_UCET",
      createdAt: den(-3, 14),
    },
  });

  // --- Vzdělávání (bod C) -------------------------------------------------
  let lekci = 0;
  const lekceKurzu = new Map<string, string[]>();
  for (const kurz of UKAZKOVE_KURZY) {
    const produkt = produkty.get(kurz.produkt);
    if (!produkt) continue;
    const ulozeny = await db.course.create({
      data: {
        productId: produkt.id,
        title: kurz.title,
        description: kurz.description,
        publishedAt: den(-80),
      },
    });
    const ids: string[] = [];
    for (const [poradi, lekce] of kurz.lekce.entries()) {
      const ulozena = await db.courseLesson.create({
        data: {
          courseId: ulozeny.id,
          title: lekce.title,
          body: lekce.body,
          position: poradi + 1,
          ...(lekce.kviz ? { kviz: { create: { questions: lekce.kviz } } } : {}),
        },
      });
      ids.push(ulozena.id);
      lekci++;
    }
    lekceKurzu.set(kurz.produkt, ids);
  }

  // Eva má za sebou první lekci Základů — ať je vidět postup a odznak.
  // Další je lekce s kvízem, takže „Pokračovat“ vede rovnou na krok
  // průvodce „Kurz a kvíz“. Lekce je z posledních 30 dní, jinak karta
  // ukáže „0 lekcí za 30 dní“.
  const zaklady = lekceKurzu.get("Kurz Základy investování") ?? [];
  if (zaklady[0]) {
    await db.lessonProgress.create({
      data: { clientId: evaId, lessonId: zaklady[0], completedAt: den(-12) },
    });
  }
  await db.clientBadge.create({
    data: { clientId: evaId, kind: "PRVNI_LEKCE", awardedAt: den(-12) },
  });

  // Eva chodí do klientské části pravidelně (9 z posledních 12 týdnů),
  // ať karta i její přehled ukazují aktivní klientku — na rozdíl od „Nechodí“.
  const evaTydny = new Set([0, 1, 2, 3, 5, 6, 8, 9, 11].map((tydnu) => isoTyden(den(-tydnu * 7))));
  await db.clientActiveWeek.createMany({
    data: [...evaTydny].map((week) => ({ clientId: evaId, week })),
  });

  // Další tři členové s účtem, ať Eva v pořadí bodů není sama („2. z 4“).
  // Heslo je náhodné a nikde se neukáže — přihlásit se do nich nedá.
  // Ondřej má víc bodů než Eva (85), Simona a Jana méně; Jana navíc
  // poslední týdny nechodí (filtr „platí, ale nechodí“).
  const technicka = lekceKurzu.get("Kurz Technická analýza") ?? [];
  const dalsiClenove = [
    { email: "ondrej.kratochvil@example.test", lekce: technicka.slice(0, 3), tydny: 12, od: 0 },
    { email: "simona.kralova@example.test", lekce: zaklady.slice(0, 2), tydny: 6, od: 0 },
    { email: "jana.prochazkova@example.test", lekce: [], tydny: 4, od: 6 },
  ];
  for (const clen of dalsiClenove) {
    const clientId = idKlientu.get(clen.email)!;
    await db.clientAccount.create({
      data: {
        clientId,
        passwordHash: await zahesluj(randomBytes(32).toString("base64url")),
        passwordSetAt: den(-50),
        invitedAt: den(-55),
        invitedById: tym.id,
        notificationsEnabled: false,
        lastLoginAt: den(-clen.od * 7 - 1),
        lastSeenAt: den(-clen.od * 7 - 1),
      },
    });
    const tydny = new Set(
      Array.from({ length: clen.tydny }, (_, i) => isoTyden(den(-(clen.od + i) * 7))),
    );
    await db.clientActiveWeek.createMany({
      data: [...tydny].map((week) => ({ clientId, week })),
    });
    for (const [i, lessonId] of clen.lekce.entries()) {
      await db.lessonProgress.create({
        data: { clientId, lessonId, completedAt: den(-20 + i * 5) },
      });
    }
    if (clen.lekce.length > 0) {
      await db.clientBadge.create({
        data: { clientId, kind: "PRVNI_LEKCE", awardedAt: den(-20) },
      });
    }
  }

  for (const clanek of UKAZKOVE_CLANKY) {
    await db.memberPost.create({
      data: { title: clanek.title, body: clanek.body, publishedAt: den(-clanek.predDny) },
    });
  }

  for (const w of UKAZKOVE_WEBINARE) {
    const webinar = await db.webinar.create({
      data: {
        title: w.title,
        description: w.description,
        startsAt: den(w.zaDny, w.hodina),
        durationMinutes: 60,
        audience: w.audience,
        joinUrl: "https://example.test/webinar",
        remindersEnabled: false,
      },
    });
    if (w.zaDny < 0) {
      await db.webinarAttendance.create({
        data: { webinarId: webinar.id, clientId: evaId, markedById: tym.id },
      });
      await db.clientBadge.create({
        data: { clientId: evaId, kind: "PRVNI_WEBINAR", awardedAt: den(w.zaDny + 1) },
      });
    }
  }

  // --- Konzultace: volné termíny a jedna rezervace Evy --------------------
  const terminy = [];
  for (const dni of [2, 5, 9, 12]) {
    terminy.push(
      await db.consultationSlot.create({
        data: {
          startsAt: den(dni, 15),
          durationMinutes: 60,
          place: "Online",
          joinUrl: "https://example.test/konzultace",
          hostId: zaklad.uzivatele.petra.id,
        },
      }),
    );
  }
  const rezervace = await db.consultationBooking.create({
    data: { slotId: terminy[1]!.id, clientId: evaId },
  });
  await db.consultationSlot.update({
    where: { id: terminy[1]!.id },
    data: { activeBookingId: rezervace.id },
  });

  // --- Cíl tržeb na tento měsíc (Dashboard → Plnění cíle) -------------------
  const mesic = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" })
    .format(new Date())
    .slice(0, 7);
  await db.salesTarget.create({ data: { month: mesic, amount: 60000 } });

  // --- Úkoly — ukázkovému účtu, ať je na Dashboardu co odškrtnout ------------
  const ukoly = [
    { email: "petr.horak@example.test", title: "Zavolat ohledně splátek", dni: 1 },
    { email: "martin.dvorak@example.test", title: "Poslat záznam webináře", dni: 0 },
    { email: "tomas.cerny@example.test", title: "Připomenout prodloužení členství", dni: -2 },
    { email: "jakub.pokorny@example.test", title: "Domluvit termín konzultace", dni: 3 },
  ];
  for (const u of ukoly) {
    const clientId = idKlientu.get(u.email);
    if (!clientId) continue;
    await db.task.create({
      data: { clientId, userId: tym.id, title: u.title, dueAt: den(u.dni, 9) },
    });
  }

  // --- Doporučitelé, slevové kódy, vlastní pole a pravidlo -----------------
  // Bez nich by zájemce viděl jen „Zatím žádný…“ a funkce by mu unikly.
  const ondrejId = idKlientu.get("ondrej.kratochvil@example.test")!;
  const katerinaId = idKlientu.get("katerina.vesela@example.test")!;
  const ondrej = await db.referrer.create({
    data: {
      kind: "KLIENT",
      name: "Ondřej Kratochvíl",
      clientId: ondrejId,
      rewardPercent: 10,
      createdAt: den(-60),
    },
  });
  const partner = await db.referrer.create({
    data: {
      kind: "PARTNER",
      name: "Podcast Investiční ráno",
      rewardPercent: 15,
      note: "Vymyšlený partner pro ukázku.",
      createdAt: den(-30),
    },
  });
  // Kateřinu přivedl Ondřej — odměna vznikne stejnou funkcí jako v provozu.
  await db.client.update({ where: { id: katerinaId }, data: { referredById: ondrej.id } });
  for (const o of await db.order.findMany({
    where: { clientId: katerinaId },
    select: { id: true },
  })) {
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: o.id }, data: { referrerId: ondrej.id } });
      await prepocitejOdmenu(tx, o.id, null);
    });
  }

  await db.discountCode.create({
    data: {
      code: "ONDREJ10",
      kind: "PROCENTA",
      value: 10,
      referrerId: ondrej.id,
      oncePerClient: true,
    },
  });
  await db.discountCode.create({
    data: { code: "RANO15", kind: "PROCENTA", value: 15, referrerId: partner.id, validTo: den(60) },
  });
  const kodKurzu = await db.discountCode.create({
    data: {
      code: "PODZIM500",
      kind: "CASTKA",
      value: 500,
      note: "Podzimní akce na kurzy.",
      validFrom: den(-7),
      validTo: den(21),
      maxUses: 50,
    },
  });
  for (const nazev of ["Kurz Základy investování", "Kurz Technická analýza"]) {
    const produkt = produkty.get(nazev);
    if (produkt)
      await db.discountCodeProduct.create({ data: { codeId: kodKurzu.id, productId: produkt.id } });
  }

  const zkusenost = await db.clientField.create({
    data: {
      name: "Zkušenost s investováním",
      kind: "VYBER",
      options: ["Začátečník", "Mírně pokročilý", "Pokročilý"],
      position: 1,
    },
  });
  const brokerUcet = await db.clientField.create({
    data: { name: "Má účet u brokera", kind: "ANO_NE", position: 2 },
  });
  for (const [email, uroven, ucet] of [
    [UKAZKOVY_KLIENT.email, "Začátečník", "ne"],
    ["ondrej.kratochvil@example.test", "Pokročilý", "ano"],
    ["simona.kralova@example.test", "Mírně pokročilý", "ano"],
  ] as const) {
    const clientId = idKlientu.get(email)!;
    await db.clientFieldValue.createMany({
      data: [
        { clientId, fieldId: zkusenost.id, value: uroven, updatedById: tym.id },
        { clientId, fieldId: brokerUcet.id, value: ucet, updatedById: tym.id },
      ],
    });
  }

  // Plánovač v ukázce pravidla nespouští — zapnuté jen ukazuje, jak vypadá.
  await db.customRule.create({
    data: {
      name: "VIP klient přestal chodit",
      enabled: true,
      conditions: [
        { druh: "stitek", tagId: stitky.get("VIP")!, ma: true },
        { druh: "nechodi", dni: 30 },
      ],
      actions: [{ druh: "ukol", userId: tym.id, nazev: "Ozvat se a zeptat, jak mu jde kurz" }],
    },
  });

  return { klientu: KLIENTI.length, faktur: zaplacene.length, lekci };
}
