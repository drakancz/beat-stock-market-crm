import { zapisDoAuditu, type Transakce } from "@/lib/audit";
import { formatDatum } from "@/lib/format";
import { prepocitejPlatnost } from "@/lib/platnost";

/**
 * Sloučení dvou karet jednoho klienta (Jakub, 27. 9. 2026, krok 2B).
 *
 * **Smí jen administrátor** — kontrola je v serverové akci
 * (`klienti/duplicity-actions.ts`), tady je jen samotný přesun.
 *
 * Administrátor vybere, která karta zůstane. Na ni se přesune všechno
 * z druhé: objednávky, poznámky, úkoly, aktivity, přílohy,
 * brokeři, platnost členství, záznamy v Chybách a v Aktivitě. Druhá
 * karta jde do Smazaných s `mergedIntoId` — příjem leadů a objednávek
 * podle ní najde zůstávající kartu.
 *
 * Údaje (Jakub schválil v plánu):
 * - jméno a e-mail zůstávají ze zůstávající karty, chybějící telefon se
 *   doplní z druhé;
 * - **souhlas s marketingem platí novější rozhodnutí** — kdo se na jedné
 *   kartě odhlásil později, než na druhé souhlasil, zůstane odhlášený;
 * - přístup do programu je povolený, když ho měla aspoň jedna karta;
 * - „v systému od“ je dřívější z obou dat, uvedení brokeři novější.
 *
 * Celé běží v jedné transakci i se zápisem do auditu (pravidlo 7).
 */

const KARTA = {
  id: true,
  name: true,
  email: true,
  phone: true,
  programAccess: true,
  reportedBrokers: true,
  brokersReportedAt: true,
  consentMarketingAt: true,
  smartemailingOptedOutAt: true,
  smartemailingUnsubscribedAt: true,
  lastContactAt: true,
  createdAt: true,
} as const;

type Karta = {
  consentMarketingAt: Date | null;
  smartemailingOptedOutAt: Date | null;
  smartemailingUnsubscribedAt: Date | null;
};

/** Kdy klient na kartě naposledy rozhodl o marketingu (souhlas či odhlášení). */
function posledniRozhodnuti(karta: Karta): number {
  return Math.max(
    karta.consentMarketingAt?.getTime() ?? 0,
    karta.smartemailingOptedOutAt?.getTime() ?? 0,
    karta.smartemailingUnsubscribedAt?.getTime() ?? 0,
  );
}

/** Pozdější ze dvou dat (nebo to, které je). */
function pozdejsi(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export interface VysledekSlouceni {
  presunuto: {
    objednavek: number;
    poznamek: number;
    ukolu: number;
    priloh: number;
  };
}

export async function sloucKlienty(
  tx: Transakce,
  { zustavaId, odchaziId, adminId }: { zustavaId: string; odchaziId: string; adminId: string },
): Promise<VysledekSlouceni> {
  // V interaktivní transakci jde všechno postupně — souběžné dotazy na
  // jednom spojení Prisma nedoporučuje.
  const zustava = await tx.client.findUniqueOrThrow({ where: { id: zustavaId }, select: KARTA });
  const odchazi = await tx.client.findUniqueOrThrow({ where: { id: odchaziId }, select: KARTA });

  const kam = { clientId: zustavaId };
  const odkud = { clientId: odchaziId };

  const objednavky = await tx.order.updateMany({ where: odkud, data: kam });

  // Doporučení (5A, 15. 10. 2026): kdo kartu přivedl, se převezme, jen když
  // zůstávající karta žádného doporučitele nemá. Stejně tak, když sloučená
  // karta sama doporučovala — doporučitel se přepojí na zůstávající kartu.
  const doporuceni = await tx.client.findMany({
    where: { id: { in: [zustavaId, odchaziId] } },
    select: { id: true, referredById: true, doporucitel: { select: { id: true } } },
  });
  const zustavaDop = doporuceni.find((k) => k.id === zustavaId)!;
  const odchaziDop = doporuceni.find((k) => k.id === odchaziId)!;
  if (!zustavaDop.referredById && odchaziDop.referredById) {
    await tx.client.update({
      where: { id: zustavaId },
      data: { referredById: odchaziDop.referredById },
    });
  }
  if (!zustavaDop.doporucitel && odchaziDop.doporucitel) {
    await tx.referrer.update({
      where: { id: odchaziDop.doporucitel.id },
      data: { clientId: zustavaId },
    });
  }
  const poznamky = await tx.clientNote.updateMany({ where: odkud, data: kam });
  const ukoly = await tx.task.updateMany({ where: odkud, data: kam });
  await tx.activity.updateMany({ where: odkud, data: kam });
  await tx.userEvent.updateMany({ where: odkud, data: kam });
  await tx.integrationError.updateMany({ where: odkud, data: kam });
  // Zprávy klientovi (3A, 4. 10. 2026) — co klient dostal, patří k němu.
  await tx.clientMessage.updateMany({ where: odkud, data: kam });
  // E-maily z karty (5D, 5. 11. 2026) — historie patří ke klientovi.
  await tx.clientEmail.updateMany({ where: odkud, data: kam });

  // Vzdělávání (3C, 4. 10. 2026): hotové lekce, účast na webinářích,
  // odznaky a aktivní týdny. Co už má zůstávající karta, se u sloučené
  // zahodí (dvojice musí být jedinečné), zbytek se přesune.
  // Po sobě, ne přes Promise.all: transakce má jedno spojení (viz platnost.ts).
  const lekce = await tx.lessonProgress.findMany({ where: kam, select: { lessonId: true } });
  // Hodnocení lekcí (5C, 18. 10. 2026) — u stejné lekce platí zůstávající.
  const hodnoceni = await tx.lessonRating.findMany({ where: kam, select: { lessonId: true } });
  const webinare = await tx.webinarAttendance.findMany({
    where: kam,
    select: { webinarId: true },
  });
  const odznaky = await tx.clientBadge.findMany({
    where: kam,
    select: { kind: true, refId: true },
  });
  const tydny = await tx.clientActiveWeek.findMany({ where: kam, select: { week: true } });
  await tx.lessonProgress.deleteMany({
    where: { ...odkud, lessonId: { in: lekce.map((l) => l.lessonId) } },
  });
  await tx.lessonProgress.updateMany({ where: odkud, data: kam });
  await tx.lessonRating.deleteMany({
    where: { ...odkud, lessonId: { in: hodnoceni.map((h) => h.lessonId) } },
  });
  await tx.lessonRating.updateMany({ where: odkud, data: kam });
  // Co pravidla klientovi udělala (5D, 18. 10. 2026) — u stejné akce platí
  // zůstávající karta, ať se nic nepošle podruhé.
  const provedeno = await tx.automationRun.findMany({
    where: kam,
    select: { ruleId: true, refKey: true },
  });
  if (provedeno.length > 0) {
    await tx.automationRun.deleteMany({
      where: { ...odkud, OR: provedeno.map((p) => ({ ruleId: p.ruleId, refKey: p.refKey })) },
    });
  }
  await tx.automationRun.updateMany({ where: odkud, data: kam });
  // Vlastní pravidla (19. 10. 2026) — stejně jako hotová pravidla výš.
  const vlastni = await tx.customRuleRun.findMany({
    where: kam,
    select: { ruleId: true, refKey: true },
  });
  if (vlastni.length > 0) {
    await tx.customRuleRun.deleteMany({
      where: { ...odkud, OR: vlastni.map((p) => ({ ruleId: p.ruleId, refKey: p.refKey })) },
    });
  }
  await tx.customRuleRun.updateMany({ where: odkud, data: kam });
  // Vlastní pole (5B, 18. 10. 2026): co zůstávající karta má, platí.
  const vyplnena = await tx.clientFieldValue.findMany({ where: kam, select: { fieldId: true } });
  await tx.clientFieldValue.deleteMany({
    where: { ...odkud, fieldId: { in: vyplnena.map((v) => v.fieldId) } },
  });
  await tx.clientFieldValue.updateMany({ where: odkud, data: kam });
  // Dotazy u lekcí (5C, 18. 10. 2026) — patří klientovi, přesouvají se.
  await tx.lessonQuestion.updateMany({ where: odkud, data: kam });
  // Rezervace konzultací (5B, 19. 10. 2026) — i zrušené, kvůli časové ose.
  await tx.consultationBooking.updateMany({ where: odkud, data: kam });
  await tx.webinarAttendance.deleteMany({
    where: { ...odkud, webinarId: { in: webinare.map((w) => w.webinarId) } },
  });
  await tx.webinarAttendance.updateMany({ where: odkud, data: kam });
  if (odznaky.length > 0) {
    await tx.clientBadge.deleteMany({
      where: { ...odkud, OR: odznaky.map((o) => ({ kind: o.kind, refId: o.refId })) },
    });
  }
  await tx.clientBadge.updateMany({ where: odkud, data: kam });
  await tx.clientActiveWeek.deleteMany({
    where: { ...odkud, week: { in: tydny.map((t) => t.week) } },
  });
  await tx.clientActiveWeek.updateMany({ where: odkud, data: kam });

  // Štítky (5B, 11. 10. 2026): co zůstávající karta už má, se u sloučené zahodí.
  const stitky = await tx.clientTagLink.findMany({ where: kam, select: { tagId: true } });
  await tx.clientTagLink.deleteMany({
    where: { ...odkud, tagId: { in: stitky.map((s) => s.tagId) } },
  });
  await tx.clientTagLink.updateMany({ where: odkud, data: kam });

  // Kvízy a certifikáty (5C, 11. 10. 2026): pokusy se přesunou všechny,
  // certifikát ke kurzu, který zůstávající karta už má, se zahodí.
  await tx.quizAttempt.updateMany({ where: odkud, data: kam });
  const certifikaty = await tx.courseCertificate.findMany({
    where: kam,
    select: { courseId: true },
  });
  await tx.courseCertificate.deleteMany({
    where: { ...odkud, courseId: { in: certifikaty.map((c) => c.courseId) } },
  });
  await tx.courseCertificate.updateMany({ where: odkud, data: kam });

  const prilohy = await tx.attachment.updateMany({
    where: { ownerType: "KLIENT", ownerId: odchaziId },
    data: { ownerId: zustavaId },
  });

  /*
   * Platnost členství: řádek na produkt. Ruční konec ze sloučené karty se
   * převezme, jen když ho zůstávající karta nemá; pak se všechno spočítá
   * znovu z objednávek, které už jsou na zůstávající kartě.
   */
  const platnostiZustava = await tx.productValidity.findMany({
    where: kam,
    select: { id: true, productId: true, manualUntil: true },
  });
  const platnostiOdchazi = await tx.productValidity.findMany({
    where: odkud,
    select: { id: true, productId: true, manualUntil: true, manualAt: true },
  });
  const zustavaPodleProduktu = new Map(platnostiZustava.map((radek) => [radek.productId, radek]));
  for (const radek of platnostiOdchazi) {
    const cil = zustavaPodleProduktu.get(radek.productId);
    if (!cil) {
      await tx.productValidity.update({ where: { id: radek.id }, data: kam });
      continue;
    }
    if (!cil.manualUntil && radek.manualUntil) {
      await tx.productValidity.update({
        where: { id: cil.id },
        data: { manualUntil: radek.manualUntil, manualAt: radek.manualAt },
      });
    }
    await tx.productValidity.delete({ where: { id: radek.id } });
  }

  /* Údaje klienta. */
  const novejsiSouhlas = posledniRozhodnuti(odchazi) > posledniRozhodnuti(zustava);
  const souhlas = novejsiSouhlas ? odchazi : zustava;
  const brokeri =
    (odchazi.brokersReportedAt?.getTime() ?? 0) > (zustava.brokersReportedAt?.getTime() ?? 0)
      ? odchazi
      : zustava;

  await tx.client.update({
    where: { id: zustavaId },
    data: {
      phone: zustava.phone ?? odchazi.phone,
      programAccess:
        zustava.programAccess === "POVOLEN" || odchazi.programAccess === "POVOLEN"
          ? "POVOLEN"
          : "NEPOVOLEN",
      consentMarketingAt: souhlas.consentMarketingAt,
      smartemailingOptedOutAt: souhlas.smartemailingOptedOutAt,
      smartemailingUnsubscribedAt: souhlas.smartemailingUnsubscribedAt,
      reportedBrokers: brokeri.reportedBrokers,
      brokersReportedAt: brokeri.brokersReportedAt,
      lastContactAt: pozdejsi(zustava.lastContactAt, odchazi.lastContactAt),
      createdAt: zustava.createdAt < odchazi.createdAt ? zustava.createdAt : odchazi.createdAt,
    },
  });

  // Účet do klientské části (krok 3A, 30. 9. 2026): když ho má jen
  // sloučená karta, přejde na zůstávající. Přihlašovací jméno je pak
  // e-mail zůstávající karty, proto se klient odhlásí. Když ho mají obě,
  // platí účet zůstávající karty — sloučená se už nepřihlásí
  // (`getKlient()` odmítá sloučené karty).
  if (!(await tx.clientAccount.findUnique({ where: kam, select: { id: true } }))) {
    await tx.clientAccount.updateMany({
      where: odkud,
      data: { ...kam, tokensValidFrom: new Date() },
    });
  }

  // Sloučená karta jde do Smazaných a ukazuje, kam se sloučila.
  await tx.client.update({
    where: { id: odchaziId },
    data: { deletedAt: new Date(), mergedIntoId: zustavaId },
  });

  await prepocitejPlatnost(tx, zustavaId);

  // Stopa na kartě, ať je vidět, odkud se vzaly objednávky a poznámky.
  await tx.clientNote.create({
    data: {
      clientId: zustavaId,
      authorId: adminId,
      text:
        `${formatDatum(new Date())} — sloučeno s kartou ${odchazi.name} (${odchazi.email}). ` +
        `Přesunuto: objednávek ${objednavky.count}, poznámek ${poznamky.count}, ` +
        `úkolů ${ukoly.count}, příloh ${prilohy.count}.` +
        (novejsiSouhlas ? " Souhlas s marketingem převzat ze sloučené karty (novější)." : ""),
    },
  });

  const presunuto = {
    objednavek: objednavky.count,
    poznamek: poznamky.count,
    ukolu: ukoly.count,
    priloh: prilohy.count,
  };

  await zapisDoAuditu(tx, {
    userId: adminId,
    entity: "clients",
    entityId: zustavaId,
    action: "klient.sloucen",
    before: { sloucena: { id: odchaziId, name: odchazi.name } },
    after: { name: zustava.name, presunuto, souhlasZeSloucene: novejsiSouhlas },
  });

  return { presunuto };
}
