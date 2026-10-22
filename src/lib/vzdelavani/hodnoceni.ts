import { db } from "@/lib/db";

import { kurzyKlienta } from "./pristup";

/**
 * Hodnocení lekce „Pomohla vám lekce?“ 1–5 (Fáze 5C, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                            |
 * | ------------- | -------------------------------------------------------------- |
 * | klient        | ohodnotit lekci v kurzu, který má zaplacený; hodnocení změnit  |
 * | uživatel      | v CRM vidět průměr u lekcí a na kartě hodnocení klienta        |
 * | administrátor | totéž — měnit hodnocení nesmí nikdo z týmu                     |
 *
 * Jen hvězdičky, žádný text (nic k moderování, žádné rady, které by
 * vypadaly jako investiční doporučení — pravidlo 9). Do auditu se nepíše,
 * stejně jako odškrtnutí lekce: je to klientův názor, ne změna údajů.
 */

export const NEJVIC_HVEZD = 5;

/** Průměr a počet hodnocení u lekcí — bez klientů ve Smazaných. */
export async function nactiHodnoceniLekci(
  lekceIds: string[],
): Promise<Map<string, { prumer: number; pocet: number }>> {
  if (lekceIds.length === 0) return new Map();
  const skupiny = await db.lessonRating.groupBy({
    by: ["lessonId"],
    where: { lessonId: { in: lekceIds }, client: { deletedAt: null } },
    _avg: { stars: true },
    _count: { _all: true },
  });
  return new Map(
    skupiny.map((skupina) => [
      skupina.lessonId,
      { prumer: skupina._avg.stars ?? 0, pocet: skupina._count._all },
    ]),
  );
}

/** Hodnocení lekcí jednoho klienta pro kartu — jen v kurzech, které má. */
export async function nactiHodnoceniKlienta(clientId: string) {
  const hodnoceni = await db.lessonRating.findMany({
    where: { clientId, lesson: { deletedAt: null, course: kurzyKlienta(clientId) } },
    orderBy: [{ lesson: { course: { title: "asc" } } }, { lesson: { position: "asc" } }],
    select: { id: true, stars: true, lesson: { select: { title: true } } },
  });
  return hodnoceni.map((radek) => ({
    id: radek.id,
    lekce: radek.lesson.title,
    hvezd: radek.stars,
  }));
}

/** Hodnocení, které klient lekci dal, nebo `null`. */
export async function hodnoceniKlientaULekce(
  clientId: string,
  lessonId: string,
): Promise<number | null> {
  const radek = await db.lessonRating.findUnique({
    where: { clientId_lessonId: { clientId, lessonId } },
    select: { stars: true },
  });
  return radek?.stars ?? null;
}

/** Průměr na jedno desetinné místo s čárkou: 4,3. */
export function formatPrumer(prumer: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(prumer);
}
