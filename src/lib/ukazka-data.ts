import { db } from "@/lib/db";
import { vystavFakturu } from "@/lib/faktury/faktury";
import { zahesluj } from "@/lib/hesla";
import { opisDelkuPlatnosti, prepocitejPlatnost } from "@/lib/platnost";
import { UKAZKOVY_KLIENT, UKAZKOVY_TYM } from "@/lib/ukazka";
import { UKAZKOVE_CLANKY, UKAZKOVE_KURZY, UKAZKOVE_WEBINARE } from "@/lib/ukazka-obsah";
import { naplnZakladniData } from "@/lib/ukazka-zaklad";

/**
 * Data živé ukázky (Jakub, 22. 10. 2026) — body B, C a D.
 *
 * Na základní data (`ukazka-zaklad.ts`) přidá to, co z CRM dělá
 * přesvědčivou ukázku: zkušební účty, vymyšlenou firmu pro faktury,
 * patnáct klientů s objednávkami za poslední tři měsíce, štítky, poznámky,
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
  objednavky?: { produkty: string[]; stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO"; predDny: number }[];
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
      { produkty: ["Členství Klub BSM — rok", "Konzultace 1:1 (60 min)"], stav: "ZAPLACENO", predDny: 85 },
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
    predDny: 89,
    poznamka: "Členství mu brzy končí, zatím neodpověděl.",
    objednavky: [{ produkty: ["Kurz Technická analýza"], stav: "ZAPLACENO", predDny: 87 }],
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
    objednavky: [{ produkty: ["Kurz Základy investování", "Kurz Technická analýza"], stav: "ZAPLACENO", predDny: 24 }],
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
        data: { clientId: klient.id, authorId: zaklad.uzivatele.petra.id, text: k.poznamka, createdAt: den(-k.predDny + 1) },
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

  // Eva má za sebou dvě lekce Základů — ať je vidět postup a odznak.
  const zaklady = lekceKurzu.get("Kurz Základy investování") ?? [];
  for (const [i, lessonId] of zaklady.slice(0, 2).entries()) {
    await db.lessonProgress.create({ data: { clientId: evaId, lessonId, completedAt: den(-50 + i * 5) } });
  }
  await db.clientBadge.create({ data: { clientId: evaId, kind: "PRVNI_LEKCE", awardedAt: den(-50) } });

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

  return { klientu: KLIENTI.length, faktur: zaplacene.length, lekci };
}
