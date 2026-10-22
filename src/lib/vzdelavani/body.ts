import { db } from "@/lib/db";

import { secistBody, urovenZBodu, type Uroven, type ZaCoBody } from "./body-pravidla";

/**
 * Body, úrovně a pořadí klientů (Fáze 5C, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                              |
 * | ------------- | ---------------------------------------------------------------- |
 * | klient        | vidět svoje body, úroveň a pořadí — **jména ostatních nikdy**    |
 * | uživatel      | v CRM vidět body a úroveň klienta (karta, náhled, seznam)        |
 * | administrátor | totéž — body nikdo ručně nepřidává ani neubírá                   |
 *
 * **Nic se neukládá** — body se skládají z hotových lekcí, splněných kvízů
 * (každý kvíz jednou), účasti na webinářích, aktivních týdnů
 * a certifikátů. Smazaná lekce ani webinář body nedávají.
 */

export interface BodyKlienta {
  body: number;
  uroven: Uroven;
  za: ZaCoBody;
}

/** Body pro víc klientů najednou — jeden dotaz na každý zdroj. */
export async function nactiBodyKlientu(clientIds: string[]): Promise<Map<string, BodyKlienta>> {
  const vysledek = new Map<string, BodyKlienta>();
  if (clientIds.length === 0) return vysledek;
  const kdo = { clientId: { in: clientIds } };

  const [lekce, kvizy, webinare, tydny, certifikaty] = await Promise.all([
    db.lessonProgress.groupBy({
      by: ["clientId"],
      where: { ...kdo, lesson: { deletedAt: null } },
      _count: { _all: true },
    }),
    // Každý kvíz jen jednou, i když ho klient splnil víckrát.
    db.quizAttempt.groupBy({ by: ["clientId", "quizId"], where: { ...kdo, passed: true } }),
    db.webinarAttendance.groupBy({
      by: ["clientId"],
      where: { ...kdo, webinar: { deletedAt: null } },
      _count: { _all: true },
    }),
    db.clientActiveWeek.groupBy({ by: ["clientId"], where: kdo, _count: { _all: true } }),
    db.courseCertificate.groupBy({ by: ["clientId"], where: kdo, _count: { _all: true } }),
  ]);

  const pocty = (radky: { clientId: string; _count: { _all: number } }[]) =>
    new Map(radky.map((radek) => [radek.clientId, radek._count._all]));
  const kvizuNaKlienta = new Map<string, number>();
  for (const { clientId } of kvizy) {
    kvizuNaKlienta.set(clientId, (kvizuNaKlienta.get(clientId) ?? 0) + 1);
  }
  const lekciNaKlienta = pocty(lekce);
  const webinaruNaKlienta = pocty(webinare);
  const tydnuNaKlienta = pocty(tydny);
  const certifikatuNaKlienta = pocty(certifikaty);

  for (const id of clientIds) {
    const za: ZaCoBody = {
      lekce: lekciNaKlienta.get(id) ?? 0,
      kvizy: kvizuNaKlienta.get(id) ?? 0,
      webinare: webinaruNaKlienta.get(id) ?? 0,
      tydny: tydnuNaKlienta.get(id) ?? 0,
      certifikaty: certifikatuNaKlienta.get(id) ?? 0,
    };
    const body = secistBody(za);
    vysledek.set(id, { body, uroven: urovenZBodu(body), za });
  }
  return vysledek;
}

/**
 * Body klienta a jeho pořadí mezi klienty s aktivním účtem v klientské
 * části (heslo, nezrušený, karta mimo Smazané). Pořadí = 1 + kolik jich má
 * víc bodů. **Vrací jen čísla, žádná jména** — jde do klientské části.
 */
export async function nactiBodyAPoradi(
  clientId: string,
): Promise<BodyKlienta & { poradi: number; z: number }> {
  const ucty = await db.clientAccount.findMany({
    where: {
      passwordHash: { not: null },
      revokedAt: null,
      client: { deletedAt: null, mergedIntoId: null },
    },
    select: { clientId: true },
  });
  const ids = [...new Set([...ucty.map((ucet) => ucet.clientId), clientId])];
  const vsechny = await nactiBodyKlientu(ids);
  const moje = vsechny.get(clientId)!;
  const vic = [...vsechny.values()].filter((jine) => jine.body > moje.body).length;
  return { ...moje, poradi: vic + 1, z: ids.length };
}
