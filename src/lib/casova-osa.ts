import { POPIS_AUDITU, type AuditniAkce } from "@/lib/audit";
import { UDALOSTI_NA_STRANKU, type DruhOsy, type UdalostOsy } from "@/lib/casova-osa-druhy";
import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { formatDatum, formatDatumCas, formatMoney } from "@/lib/format";
import { NADPIS_NA_OSE, type IdPravidla } from "@/lib/pravidla-druhy";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";
import { ORDER_STATUS_LABEL } from "@/lib/types";
import { POPIS_ODZNAKU } from "@/lib/vzdelavani/odznaky";

/**
 * Časová osa klienta — okno na kartě klienta (Fáze 5B, Jakub 16. 10. 2026).
 *
 * **Oprávnění (Jakub):**
 *
 * - Osu **vidí každý přihlášený**, kdo vidí kartu klienta. Klient ji
 *   nevidí nikdy.
 * - Druh **Změny** (auditní log) **jen administrátor** — auditní log smí
 *   číst jen on (security_warnings.md, pravidlo 7). Ostatním se nejen
 *   neukáže, ale ani nenačte.
 *
 * Osa nic neukládá, skládá se z existujících tabulek. Každý zdroj vrací
 * nejvýš `UDALOSTI_NA_STRANKU` událostí starších než `pred`; z toho se
 * vezme nejnovějších sto. Smazané záznamy (`deletedAt`) na osu nepatří.
 *
 * **O přihlášení klienta se ukládá jen poslední čas** (`lastLoginAt`),
 * historie přihlášení neexistuje — na ose je proto jen to poslední.
 */

export type VysledekOsy =
  { ok: true; udalosti: UdalostOsy[]; starsi: string | null } | { ok: false };

const ZKRACENI = 160;

function zkrat(text: string): string {
  const jedenRadek = text.replace(/\s+/g, " ").trim();
  return jedenRadek.length > ZKRACENI ? `${jedenRadek.slice(0, ZKRACENI - 1)}…` : jedenRadek;
}

/** Rozpracovaná událost — čas se naformátuje až po výběru stovky. */
type Surova = Omit<UdalostOsy, "kdy" | "cas"> & { kdy: Date };

export async function nactiCasovouOsu(
  viewer: Viewer,
  klientId: string,
  moznosti: { druh: DruhOsy | null; pred: Date | null },
): Promise<VysledekOsy> {
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  if (moznosti.druh === "zmeny" && !jeAdmin) return { ok: false };

  // Viditelnost klienta je v dotazu — cizí nebo smazaný klient se nenajde.
  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId }, viditelniKlienti(viewer)] },
    select: { id: true, createdAt: true },
  });
  if (!klient) return { ok: false };

  const pred = moznosti.pred ?? new Date(8_640_000_000_000_000);
  const chci = (druh: DruhOsy) =>
    (moznosti.druh === null || moznosti.druh === druh) && (druh !== "zmeny" || jeAdmin);

  const casti = await Promise.all([
    chci("objednavky") ? objednavky(klient.id, pred) : [],
    chci("tym") ? tym(klient.id, pred) : [],
    chci("klient") ? klientskaCast(klient.id, klient.createdAt, pred) : [],
    chci("zmeny") ? zmeny(klient.id, pred) : [],
  ]);

  const vse = casti
    .flat()
    .filter((udalost) => udalost.kdy < pred)
    .sort((a, b) => b.kdy.getTime() - a.kdy.getTime());

  const stranka = vse.slice(0, UDALOSTI_NA_STRANKU);
  const posledni = stranka.at(-1);

  return {
    ok: true,
    udalosti: stranka.map((udalost) => ({
      ...udalost,
      kdy: udalost.kdy.toISOString(),
      cas: formatDatumCas(udalost.kdy),
    })),
    starsi: vse.length > UDALOSTI_NA_STRANKU && posledni ? posledni.kdy.toISOString() : null,
  };
}

/** O jednu víc než stránka — podle té navíc se pozná, že jsou starší. */
const LIMIT = UDALOSTI_NA_STRANKU + 1;

/* ---------- Objednávky a platby ---------- */

async function objednavky(clientId: string, pred: Date): Promise<Surova[]> {
  const vyber = {
    id: true,
    number: true,
    status: true,
    currency: true,
    createdAt: true,
    paidAt: true,
    paymentReminders: true,
    paymentRemindedAt: true,
    discountCode: { select: { code: true } },
    items: {
      select: {
        quantity: true,
        netPrice: true,
        vatPercent: true,
        product: { select: { name: true, netPrice: true } },
      },
    },
  } as const;

  const [zalozene, zaplacene, pripomenute, platnosti] = await Promise.all([
    db.order.findMany({
      where: { clientId, deletedAt: null, createdAt: { lt: pred } },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: vyber,
    }),
    db.order.findMany({
      where: { clientId, deletedAt: null, paidAt: { lt: pred } },
      orderBy: { paidAt: "desc" },
      take: LIMIT,
      select: vyber,
    }),
    db.order.findMany({
      where: { clientId, deletedAt: null, paymentRemindedAt: { lt: pred } },
      orderBy: { paymentRemindedAt: "desc" },
      take: LIMIT,
      select: { id: true, number: true, paymentReminders: true, paymentRemindedAt: true },
    }),
    db.productValidity.findMany({
      where: { clientId },
      select: {
        id: true,
        validUntil: true,
        manualAt: true,
        manualUntil: true,
        product: { select: { name: true } },
      },
    }),
  ]);

  const popisObjednavky = (objednavka: (typeof zalozene)[number]) => {
    const celkem = objednavka.items.reduce(
      (soucet, polozka) => soucet + cenaPolozkyBezDph(polozka) * polozka.quantity,
      0,
    );
    const produkty = objednavka.items
      .map((polozka) =>
        polozka.quantity > 1
          ? `${polozka.product.name} (${polozka.quantity}×)`
          : polozka.product.name,
      )
      .join(", ");
    return [
      produkty || "Bez produktů",
      `${formatMoney(celkem, objednavka.currency)} bez DPH`,
      objednavka.discountCode ? `slevový kód ${objednavka.discountCode.code}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const ted = new Date();

  return [
    ...zalozene.map((objednavka) => ({
      id: `objednavka-${objednavka.id}`,
      druh: "objednavky" as const,
      kdy: objednavka.createdAt,
      nadpis: `Objednávka ${objednavka.number} (${ORDER_STATUS_LABEL[objednavka.status]})`,
      popis: popisObjednavky(objednavka),
      kdo: "Landing Page",
    })),
    ...zaplacene.map((objednavka) => ({
      id: `zaplaceno-${objednavka.id}`,
      druh: "objednavky" as const,
      kdy: objednavka.paidAt!,
      nadpis: `Zaplaceno: objednávka ${objednavka.number}`,
      popis: popisObjednavky(objednavka),
      kdo: null,
    })),
    ...pripomenute.map((objednavka) => ({
      id: `pripominka-${objednavka.id}`,
      druh: "objednavky" as const,
      kdy: objednavka.paymentRemindedAt!,
      nadpis: `Připomínka platby: objednávka ${objednavka.number}`,
      popis: objednavka.paymentReminders > 1 ? "Druhá připomínka" : "První připomínka",
      kdo: "CRM",
    })),
    // Konec členství jen ten, který už nastal — budoucí konec je v Údajích.
    ...platnosti
      .filter((platnost) => platnost.validUntil && platnost.validUntil <= ted)
      .map((platnost) => ({
        id: `konec-${platnost.id}`,
        druh: "objednavky" as const,
        kdy: platnost.validUntil!,
        nadpis: `Konec platnosti: ${platnost.product.name}`,
        popis: null,
        kdo: null,
      })),
    ...platnosti
      .filter((platnost) => platnost.manualAt)
      .map((platnost) => ({
        id: `rucne-${platnost.id}`,
        druh: "objednavky" as const,
        kdy: platnost.manualAt!,
        nadpis: `Ruční úprava platnosti: ${platnost.product.name}`,
        popis: platnost.manualUntil ? `Nový konec ${formatDatum(platnost.manualUntil)}` : null,
        kdo: "administrátor",
      })),
  ];
}

/* ---------- Tým: poznámky, úkoly ---------- */

async function tym(clientId: string, pred: Date): Promise<Surova[]> {
  const [poznamky, zalozeneUkoly, hotoveUkoly, pravidla, vlastniPravidla, emaily] =
    await Promise.all([
      db.clientNote.findMany({
        where: { clientId, deletedAt: null, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, text: true, createdAt: true, author: { select: { name: true } } },
      }),
      db.task.findMany({
        where: { clientId, deletedAt: null, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          title: true,
          dueAt: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
      db.task.findMany({
        where: { clientId, deletedAt: null, doneAt: { lt: pred } },
        orderBy: { doneAt: "desc" },
        take: LIMIT,
        select: { id: true, title: true, doneAt: true, user: { select: { name: true } } },
      }),
      // Co klientovi udělalo pravidlo „když X, udělej Y“ (5D, 18. 10. 2026).
      db.automationRun.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, ruleId: true, detail: true, createdAt: true },
      }),
      // Vlastní pravidla (19. 10. 2026) — `detail` je název pravidla.
      db.customRuleRun.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, detail: true, createdAt: true },
      }),
      // E-maily z karty (5D, 5. 11. 2026) — jen předmět, text je v okně Poslat email.
      db.clientEmail.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      }),
    ]);

  return [
    ...emaily.map((email) => ({
      id: `email-${email.id}`,
      druh: "tym" as const,
      kdy: email.createdAt,
      nadpis: `E-mail: ${email.subject}`,
      popis: email.status === "ODESLANO" ? null : "Neodesláno",
      kdo: email.author?.name ?? null,
    })),
    ...vlastniPravidla.map((provedeno) => ({
      id: `vlastni-pravidlo-${provedeno.id}`,
      druh: "tym" as const,
      kdy: provedeno.createdAt,
      nadpis: `Vlastní pravidlo: ${provedeno.detail ?? ""}`,
      popis: null,
      kdo: "CRM (pravidlo)",
    })),
    ...pravidla.map((provedeno) => ({
      id: `pravidlo-${provedeno.id}`,
      druh: "tym" as const,
      kdy: provedeno.createdAt,
      nadpis: NADPIS_NA_OSE[provedeno.ruleId as IdPravidla] ?? "Pravidlo",
      popis: provedeno.detail,
      kdo: "CRM (pravidlo)",
    })),
    ...poznamky.map((poznamka) => ({
      id: `poznamka-${poznamka.id}`,
      druh: "tym" as const,
      kdy: poznamka.createdAt,
      nadpis: "Poznámka",
      popis: zkrat(poznamka.text),
      // Poznámka bez autora přišla z webu nebo z objednávky.
      kdo: poznamka.author?.name ?? "web a objednávky",
    })),
    ...zalozeneUkoly.map((ukol) => ({
      id: `ukol-${ukol.id}`,
      druh: "tym" as const,
      kdy: ukol.createdAt,
      nadpis: `Úkol: ${ukol.title}`,
      popis: `Termín ${formatDatum(ukol.dueAt)}, řeší ${ukol.user.name}`,
      kdo: null,
    })),
    ...hotoveUkoly.map((ukol) => ({
      id: `ukol-hotovy-${ukol.id}`,
      druh: "tym" as const,
      kdy: ukol.doneAt!,
      nadpis: `Hotový úkol: ${ukol.title}`,
      popis: null,
      kdo: ukol.user.name,
    })),
  ];
}

/* ---------- Klient: klientská část a vzdělávání ---------- */

async function klientskaCast(clientId: string, zalozen: Date, pred: Date): Promise<Surova[]> {
  const [ucet, lekce, kvizy, certifikaty, odznaky, webinare, zpravy, hodnoceni, dotazy, rezervace] =
    await Promise.all([
      db.clientAccount.findUnique({
        where: { clientId },
        select: {
          invitedAt: true,
          passwordSetAt: true,
          lastLoginAt: true,
          revokedAt: true,
          invitedBy: { select: { name: true } },
        },
      }),
      db.lessonProgress.findMany({
        where: { clientId, completedAt: { lt: pred } },
        orderBy: { completedAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          completedAt: true,
          lesson: { select: { title: true, course: { select: { title: true } } } },
        },
      }),
      db.quizAttempt.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          createdAt: true,
          correct: true,
          total: true,
          passed: true,
          quiz: { select: { lesson: { select: { title: true } } } },
        },
      }),
      db.courseCertificate.findMany({
        where: { clientId, issuedAt: { lt: pred } },
        orderBy: { issuedAt: "desc" },
        take: LIMIT,
        select: { id: true, number: true, courseTitle: true, issuedAt: true },
      }),
      db.clientBadge.findMany({
        where: { clientId, awardedAt: { lt: pred } },
        orderBy: { awardedAt: "desc" },
        take: LIMIT,
        select: { id: true, kind: true, refId: true, awardedAt: true },
      }),
      db.webinarAttendance.findMany({
        where: { clientId, webinar: { startsAt: { lt: pred } } },
        orderBy: { webinar: { startsAt: "desc" } },
        take: LIMIT,
        select: { id: true, webinar: { select: { title: true, startsAt: true } } },
      }),
      db.clientMessage.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          text: true,
          createdAt: true,
          readAt: true,
          author: { select: { name: true } },
        },
      }),
      // Hodnocení lekce (5C, 18. 10. 2026) — čas poslední změny.
      db.lessonRating.findMany({
        where: { clientId, updatedAt: { lt: pred } },
        orderBy: { updatedAt: "desc" },
        take: LIMIT,
        select: { id: true, stars: true, updatedAt: true, lesson: { select: { title: true } } },
      }),
      // Dotazy u lekcí (5C, 18. 10. 2026) — stažené a smazané ne.
      db.lessonQuestion.findMany({
        where: { clientId, deletedAt: null, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          text: true,
          createdAt: true,
          answeredAt: true,
          answeredBy: { select: { name: true } },
          lesson: { select: { title: true } },
        },
      }),
      // Rezervace konzultací (5B, 19. 10. 2026) — i zrušené.
      db.consultationBooking.findMany({
        where: { clientId, createdAt: { lt: pred } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          createdAt: true,
          cancelledAt: true,
          cancelledBy: { select: { name: true } },
          slot: { select: { startsAt: true } },
        },
      }),
    ]);

  // Odznak za kurz nese id kurzu; název se doplní jedním dotazem.
  const idKurzu = [...new Set(odznaky.map((odznak) => odznak.refId).filter(Boolean))];
  const kurzy = idKurzu.length
    ? await db.course.findMany({
        where: { id: { in: idKurzu } },
        select: { id: true, title: true },
      })
    : [];
  const nazevKurzu = new Map(kurzy.map((kurz) => [kurz.id, kurz.title]));

  const udalosti: Surova[] = [
    {
      id: "klient-zalozen",
      druh: "klient",
      kdy: zalozen,
      nadpis: "Klient v CRM",
      popis: null,
      kdo: null,
    },
  ];

  if (ucet) {
    udalosti.push({
      id: "ucet-pozvanka",
      druh: "klient",
      kdy: ucet.invitedAt,
      nadpis: "Pozvánka do klientské části",
      popis: null,
      kdo: ucet.invitedBy?.name ?? null,
    });
    if (ucet.passwordSetAt) {
      udalosti.push({
        id: "ucet-heslo",
        druh: "klient",
        kdy: ucet.passwordSetAt,
        nadpis: "Nastavení hesla do klientské části",
        popis: null,
        kdo: "klient",
      });
    }
    if (ucet.lastLoginAt) {
      udalosti.push({
        id: "ucet-prihlaseni",
        druh: "klient",
        kdy: ucet.lastLoginAt,
        nadpis: "Poslední přihlášení do klientské části",
        popis: "Starší přihlášení se neukládají.",
        kdo: "klient",
      });
    }
    if (ucet.revokedAt) {
      udalosti.push({
        id: "ucet-zrusen",
        druh: "klient",
        kdy: ucet.revokedAt,
        nadpis: "Zrušení přístupu do klientské části",
        popis: null,
        kdo: null,
      });
    }
  }

  return [
    ...udalosti,
    ...lekce.map((hotovo) => ({
      id: `lekce-${hotovo.id}`,
      druh: "klient" as const,
      kdy: hotovo.completedAt,
      nadpis: `Dokončená lekce: ${hotovo.lesson.title}`,
      popis: hotovo.lesson.course.title,
      kdo: "klient",
    })),
    ...kvizy.map((pokus) => ({
      id: `kviz-${pokus.id}`,
      druh: "klient" as const,
      kdy: pokus.createdAt,
      nadpis: `Kvíz: ${pokus.quiz.lesson.title}`,
      popis: `${pokus.correct}/${pokus.total} — ${pokus.passed ? "splněno" : "nesplněno"}`,
      kdo: "klient",
    })),
    ...dotazy.map((dotaz) => ({
      id: `dotaz-${dotaz.id}`,
      druh: "klient" as const,
      kdy: dotaz.createdAt,
      nadpis: `Dotaz u lekce: ${dotaz.lesson.title}`,
      popis: zkrat(dotaz.text),
      kdo: "klient",
    })),
    ...dotazy
      .filter((dotaz) => dotaz.answeredAt && dotaz.answeredAt < pred)
      .map((dotaz) => ({
        id: `dotaz-odpoved-${dotaz.id}`,
        druh: "tym" as const,
        kdy: dotaz.answeredAt!,
        nadpis: `Odpověď na dotaz u lekce: ${dotaz.lesson.title}`,
        popis: null,
        kdo: dotaz.answeredBy?.name ?? null,
      })),
    ...rezervace.map((r) => ({
      id: `konzultace-${r.id}`,
      druh: "klient" as const,
      kdy: r.createdAt,
      nadpis: "Rezervace konzultace",
      popis: formatDatumCas(r.slot.startsAt),
      kdo: "klient",
    })),
    ...rezervace
      .filter((r) => r.cancelledAt && r.cancelledAt < pred)
      .map((r) => ({
        id: `konzultace-zrusena-${r.id}`,
        druh: "klient" as const,
        kdy: r.cancelledAt!,
        nadpis: "Zrušená konzultace",
        popis: formatDatumCas(r.slot.startsAt),
        kdo: r.cancelledBy?.name ?? "klient",
      })),
    ...hodnoceni.map((hodnoceni) => ({
      id: `hodnoceni-${hodnoceni.id}`,
      druh: "klient" as const,
      kdy: hodnoceni.updatedAt,
      nadpis: `Hodnocení lekce: ${hodnoceni.lesson.title}`,
      popis: `${hodnoceni.stars} z 5`,
      kdo: "klient",
    })),
    ...certifikaty.map((certifikat) => ({
      id: `certifikat-${certifikat.id}`,
      druh: "klient" as const,
      kdy: certifikat.issuedAt,
      nadpis: `Certifikát: ${certifikat.courseTitle}`,
      popis: certifikat.number,
      kdo: "CRM",
    })),
    ...odznaky.map((odznak) => ({
      id: `odznak-${odznak.id}`,
      druh: "klient" as const,
      kdy: odznak.awardedAt,
      nadpis: `Odznak: ${POPIS_ODZNAKU[odznak.kind].nazev}`,
      popis: odznak.refId ? (nazevKurzu.get(odznak.refId) ?? null) : null,
      kdo: "CRM",
    })),
    ...webinare.map((ucast) => ({
      id: `webinar-${ucast.id}`,
      druh: "klient" as const,
      kdy: ucast.webinar.startsAt,
      nadpis: `Účast na webináři: ${ucast.webinar.title}`,
      popis: null,
      kdo: null,
    })),
    ...zpravy.map((zprava) => ({
      id: `zprava-${zprava.id}`,
      druh: "klient" as const,
      kdy: zprava.createdAt,
      nadpis: zprava.readAt ? "Zpráva klientovi (přečtená)" : "Zpráva klientovi",
      popis: zkrat(zprava.text),
      kdo: zprava.author?.name ?? null,
    })),
  ];
}

/* ---------- Změny z auditního logu (jen administrátor) ---------- */

async function zmeny(clientId: string, pred: Date): Promise<Surova[]> {
  // I objednávky v koši — jejich smazání je taky změna u klienta.
  const objednavkyKlienta = await db.order.findMany({
    where: { clientId },
    select: { id: true },
  });

  const zaznamy = await db.auditLogEntry.findMany({
    where: {
      at: { lt: pred },
      OR: [
        { entity: "clients", entityId: clientId },
        {
          entity: "orders",
          entityId: { in: objednavkyKlienta.map((objednavka) => objednavka.id) },
        },
      ],
    },
    orderBy: { at: "desc" },
    take: LIMIT,
    select: { id: true, at: true, action: true, user: { select: { name: true } } },
  });

  return zaznamy.map((zaznam) => ({
    id: `audit-${zaznam.id}`,
    druh: "zmeny" as const,
    kdy: zaznam.at,
    nadpis: POPIS_AUDITU[zaznam.action as AuditniAkce] ?? zaznam.action,
    popis: null,
    // Prázdné „kdo“ = změnu neudělal člověk (web, objednávka, plánovač).
    kdo: zaznam.user?.name ?? "CRM nebo web",
  }));
}
