import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { dataCertifikatu, posliWebhook } from "@/lib/webhooky";

import { prectiOtazky } from "./kvizy";
import { kurzyKlienta } from "./pristup";

/**
 * Certifikát o absolvování kurzu (Fáze 5C, Jakub 11. 10. 2026).
 *
 * Klient ho dostane, když má v kurzu **všechny lekce hotové a všechny
 * kvízy splněné** (aspoň 80 %). Vydává se sám po odškrtnutí lekce nebo
 * splnění kvízu, audit `certifikat.vydan` bez „kdo". Jméno klienta
 * a název kurzu se zapíšou v den vydání; číslo `CERT-RRRR-NNNN` přidělí
 * databáze. **Certifikát se nikdy neodebírá** — ani když administrátor
 * později přidá lekci nebo kvíz (stejně jako odznaky).
 *
 * Pravost zatím nejde ověřit na veřejné adrese (Jakub, 11. 10. 2026) —
 * certifikát stáhne jen sám klient po přihlášení.
 */

/** Co klientovi v kurzu ke certifikátu ještě chybí. */
export interface StavCertifikatu {
  lekciZbyva: number;
  /** Názvy lekcí, jejichž kvíz klient ještě nesplnil. */
  kvizyZbyva: string[];
}

/** Co v kurzu chybí ke certifikátu; `null` = kurz nemá lekce nebo ho klient nevidí. */
export async function coChybiKCertifikatu(
  clientId: string,
  courseId: string,
): Promise<StavCertifikatu | null> {
  const kurz = await db.course.findFirst({
    where: { AND: [{ id: courseId }, kurzyKlienta(clientId)] },
    select: {
      lekce: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          title: true,
          hotovo: { where: { clientId }, select: { id: true } },
          kviz: {
            select: {
              deletedAt: true,
              questions: true,
              pokusy: { where: { clientId, passed: true }, take: 1, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!kurz || kurz.lekce.length === 0) return null;

  return {
    lekciZbyva: kurz.lekce.filter((lekce) => lekce.hotovo.length === 0).length,
    kvizyZbyva: kurz.lekce
      .filter(
        (lekce) =>
          lekce.kviz &&
          !lekce.kviz.deletedAt &&
          prectiOtazky(lekce.kviz.questions).length > 0 &&
          lekce.kviz.pokusy.length === 0,
      )
      .map((lekce) => lekce.title),
  };
}

/**
 * Vydá certifikát, když je kurz splněný a klient ho ještě nemá. Vrací
 * `true`, když certifikát právě vznikl. Nic nevyhazuje — selhání nesmí
 * shodit odškrtnutí lekce ani odeslání kvízu; do logu jde jen druh chyby.
 */
export async function vydejCertifikatKdyzSplneno(
  clientId: string,
  courseId: string,
): Promise<boolean> {
  try {
    const uz = await db.courseCertificate.findUnique({
      where: { clientId_courseId: { clientId, courseId } },
      select: { id: true },
    });
    if (uz) return false;

    const stav = await coChybiKCertifikatu(clientId, courseId);
    if (!stav || stav.lekciZbyva > 0 || stav.kvizyZbyva.length > 0) return false;

    const [klient, kurz] = await Promise.all([
      db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } }),
      db.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } }),
    ]);

    const vydanyId = await db.$transaction(async (tx) => {
      // Souběžné odškrtnutí dvou lekcí: jedinečnost (klient, kurz) pustí
      // jen jeden zápis, druhý se tiše přeskočí.
      const vydano = await tx.courseCertificate.createManyAndReturn({
        data: [{ clientId, courseId, clientName: klient.name, courseTitle: kurz.title }],
        skipDuplicates: true,
        select: { id: true, number: true },
      });
      const certifikat = vydano[0];
      if (!certifikat) return null;
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "course_certificates",
        entityId: certifikat.id,
        action: "certifikat.vydan",
        after: { cislo: certifikat.number, kurz: kurz.title, klient: clientId },
      });
      return certifikat.id;
    });
    if (!vydanyId) return false;
    // Odchozí webhooky (19. 10. 2026) — dokončený kurz, bez kontaktů.
    posliWebhook("kurz.dokoncen", () => dataCertifikatu(vydanyId));
    return true;
  } catch (chyba) {
    console.error(
      "Certifikát se nepodařilo vydat:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return false;
  }
}

/** Certifikáty klienta (nejnovější první) — klientská část i karta v CRM. */
export async function nactiCertifikaty(clientId: string) {
  return db.courseCertificate.findMany({
    where: { clientId },
    orderBy: { issuedAt: "desc" },
    select: { id: true, number: true, courseId: true, courseTitle: true, issuedAt: true },
  });
}
