import { z } from "zod";

import { db } from "@/lib/db";

import { MAX_MOZNOSTI, MAX_OTAZEK, MIN_MOZNOSTI, PRAH_KVIZU } from "./kvizy-pravidla";
import { kurzyKlienta } from "./pristup";

/**
 * Kvíz na konci lekce (Fáze 5C, Jakub 11. 10. 2026).
 *
 * - **Zakládá a mění jen administrátor** (`kurzy-actions.ts`), výsledky
 *   na kartě klienta vidí každý přihlášený.
 * - Otázka má 2–6 možností a jednu správnou. **Splněno = aspoň 80 %**
 *   (`PRAH_KVIZU`), pokusů neomezeně.
 * - **Správné odpovědi do prohlížeče klienta nikdy nejdou** — klient
 *   dostane otázky bez `spravna` a hodnotí server (`vyhodnotKviz()`). Po
 *   odeslání se dozví, které otázky měl špatně, ne jaká byla správná
 *   odpověď, ať má opakování smysl.
 * - Kdo kvíz jednou splnil, tomu splnění zůstává i po úpravě otázek —
 *   jinak by oprava překlepu mohla lidem vzít certifikát.
 */

export { MAX_MOZNOSTI, MAX_OTAZEK, MIN_MOZNOSTI, PRAH_KVIZU };

const otazkaSchema = z
  .object({
    otazka: z
      .string()
      .trim()
      .min(1, "Každá otázka potřebuje text.")
      .max(500, "Otázka je příliš dlouhá."),
    moznosti: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Vyplň všechny možnosti, nebo prázdné smaž.")
          .max(200, "Možnost je příliš dlouhá."),
      )
      .min(MIN_MOZNOSTI, `Každá otázka potřebuje aspoň ${MIN_MOZNOSTI} možnosti.`)
      .max(MAX_MOZNOSTI, `Otázka může mít nejvýš ${MAX_MOZNOSTI} možností.`),
    // Formulář posílá -1, dokud správná není označená. Rozsah se hlídá
    // až v `refine`, ať je chyba jedna a česky.
    spravna: z.number().int(),
  })
  .refine(
    (otazka) => otazka.spravna >= 0 && otazka.spravna < otazka.moznosti.length,
    "U každé otázky vyber správnou odpověď.",
  );

/** Tvar otázek v `lesson_quizzes.questions`. Ověřuje se při uložení i při čtení. */
export const kvizSchema = z
  .array(otazkaSchema)
  .min(1, "Kvíz potřebuje aspoň jednu otázku.")
  .max(MAX_OTAZEK, `Kvíz může mít nejvýš ${MAX_OTAZEK} otázek.`);

export type OtazkaKvizu = z.infer<typeof otazkaSchema>;

/** Otázka, jak ji vidí klient — bez správné odpovědi. */
export interface OtazkaProKlienta {
  otazka: string;
  moznosti: string[];
}

/** Otázky z databáze. Poškozený obsah se chová jako kvíz bez otázek. */
export function prectiOtazky(hodnota: unknown): OtazkaKvizu[] {
  const vysledek = kvizSchema.safeParse(hodnota);
  return vysledek.success ? vysledek.data : [];
}

export function jeSplneno(spravne: number, celkem: number): boolean {
  // Celá čísla, ať 8 z 10 není kvůli zaokrouhlení „79,999 %".
  return celkem > 0 && spravne * 100 >= celkem * PRAH_KVIZU;
}

export interface VysledekKvizu {
  spravne: number;
  celkem: number;
  splneno: boolean;
  /** Pořadí (od 0) otázek, které byly špatně. */
  spatne: number[];
}

/** Ohodnotí odpovědi (pořadí zvolené možnosti u každé otázky). */
export function vyhodnotKviz(otazky: OtazkaKvizu[], odpovedi: number[]): VysledekKvizu {
  const spatne = otazky.flatMap((otazka, poradi) =>
    odpovedi[poradi] === otazka.spravna ? [] : [poradi],
  );
  const spravne = otazky.length - spatne.length;
  return { spravne, celkem: otazky.length, splneno: jeSplneno(spravne, otazky.length), spatne };
}

export interface KvizKlienta {
  otazky: OtazkaProKlienta[];
  /** Nejlepší dosavadní pokus, nebo `null`. */
  nejlepsi: { spravne: number; celkem: number; splneno: boolean } | null;
}

/**
 * Kvíz u lekce pro klienta, **bez správných odpovědí**. `null` = lekce
 * kvíz nemá, nebo ji klient nevidí. `clientId` vždy z přihlášení.
 */
export async function nactiKvizKlienta(
  clientId: string,
  lessonId: string,
): Promise<KvizKlienta | null> {
  const kviz = await db.lessonQuiz.findFirst({
    where: {
      lessonId,
      deletedAt: null,
      lesson: { deletedAt: null, course: kurzyKlienta(clientId) },
    },
    select: {
      questions: true,
      pokusy: {
        where: { clientId },
        orderBy: [{ passed: "desc" }, { correct: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { correct: true, total: true, passed: true },
      },
    },
  });
  if (!kviz) return null;
  const otazky = prectiOtazky(kviz.questions);
  if (otazky.length === 0) return null;

  const pokus = kviz.pokusy[0];
  return {
    otazky: otazky.map(({ otazka, moznosti }) => ({ otazka, moznosti })),
    nejlepsi: pokus ? { spravne: pokus.correct, celkem: pokus.total, splneno: pokus.passed } : null,
  };
}

/**
 * Výsledky kvízů klienta pro kartu v CRM: u každého kvízu v kurzech,
 * které klient má, nejlepší pokus a počet pokusů. Volající kartu už
 * ověřil přes viditelnost.
 */
export async function nactiVysledkyKvizu(clientId: string) {
  const kvizy = await db.lessonQuiz.findMany({
    where: {
      deletedAt: null,
      lesson: { deletedAt: null, course: kurzyKlienta(clientId) },
      pokusy: { some: { clientId } },
    },
    orderBy: [{ lesson: { course: { title: "asc" } } }, { lesson: { position: "asc" } }],
    select: {
      id: true,
      lesson: { select: { title: true, course: { select: { title: true } } } },
      pokusy: {
        where: { clientId },
        orderBy: [{ passed: "desc" }, { correct: "desc" }, { createdAt: "desc" }],
        select: { correct: true, total: true, passed: true },
      },
    },
  });
  return kvizy.map((kviz) => ({
    id: kviz.id,
    lekce: kviz.lesson.title,
    kurz: kviz.lesson.course.title,
    pokusu: kviz.pokusy.length,
    nejlepsi: kviz.pokusy[0]!,
  }));
}
