import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";

/**
 * Dotazy u lekcí (Fáze 5C, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                                 |
 * | ------------- | ------------------------------------------------------------------- |
 * | klient        | u otevřené lekce svého kurzu se zeptat, vidět **jen svoje** dotazy, |
 * |               | nezodpovězený stáhnout                                               |
 * | uživatel      | vidět všechny dotazy (Vzdělávání → Dotazy), odpovědět, odpověď opravit |
 * | administrátor | navíc dotaz smazat (spam)                                           |
 * | nepřihlášený  | nic                                                                 |
 *
 * **Soukromé** — ostatní klienti dotaz nevidí, nic se nezveřejňuje. Text je
 * volný, proto ho MCP ani Asistent AI nedostanou a do auditu nejde.
 * Odpověď nesmí vypadat jako investiční doporučení (pravidlo 9) — připomíná
 * to formulář odpovědi.
 */

export const MAX_DOTAZ = 2000;
export const MAX_ODPOVED = 4000;
/** Kolik nezodpovězených dotazů smí klient mít u jedné lekce najednou. */
export const MAX_OTEVRENYCH = 3;

export interface DotazKlienta {
  id: string;
  text: string;
  kdy: string;
  odpoved: string | null;
  odpovezeno: string | null;
}

/** Dotazy klienta u lekce — jen jeho, bez smazaných. */
export async function nactiDotazyKlienta(clientId: string, lessonId: string) {
  const dotazy = await db.lessonQuestion.findMany({
    where: { clientId, lessonId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, text: true, createdAt: true, answer: true, answeredAt: true },
  });
  return dotazy.map((dotaz): DotazKlienta => ({
    id: dotaz.id,
    text: dotaz.text,
    kdy: formatDatumCas(dotaz.createdAt),
    odpoved: dotaz.answer,
    odpovezeno: dotaz.answeredAt ? formatDatumCas(dotaz.answeredAt) : null,
  }));
}

/** Kolik dotazů čeká na odpověď — číslo u záložky Dotazy. */
export async function pocetCekajicichDotazu(): Promise<number> {
  return db.lessonQuestion.count({
    where: { deletedAt: null, answeredAt: null, client: { deletedAt: null } },
  });
}

/** Dotazy pro tým: nejdřív čekající (nejstarší první), pak zodpovězené. */
export async function nactiDotazyProTym(jenCekajici: boolean) {
  const dotazy = await db.lessonQuestion.findMany({
    where: {
      deletedAt: null,
      client: { deletedAt: null },
      ...(jenCekajici ? { answeredAt: null } : {}),
    },
    orderBy: [{ answeredAt: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      text: true,
      createdAt: true,
      answer: true,
      answeredAt: true,
      answeredBy: { select: { name: true } },
      client: { select: { id: true, name: true } },
      lesson: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
    },
  });
  return dotazy.map((dotaz) => ({
    id: dotaz.id,
    text: dotaz.text,
    kdy: formatDatumCas(dotaz.createdAt),
    odpoved: dotaz.answer,
    odpovezeno: dotaz.answeredAt ? formatDatumCas(dotaz.answeredAt) : null,
    kdoOdpovedel: dotaz.answeredBy?.name ?? null,
    klient: dotaz.client,
    lekce: dotaz.lesson.title,
    kurz: dotaz.lesson.course,
  }));
}
