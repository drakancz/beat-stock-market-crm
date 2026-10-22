/**
 * Body a úrovně (Fáze 5C, Jakub 18. 10. 2026) — hodnoty bez přístupu
 * k databázi, ať je může použít i stránka v prohlížeči.
 *
 * **Body jsou jen za vzdělávání a aktivitu, nikdy za obchody ani nákupy**
 * (security_warnings.md, pravidlo 9). Hodnoty jsou pevně tady, v Nastavení
 * se nemění (Jakub).
 */

export const BODY = {
  lekce: 10,
  kviz: 20,
  webinar: 30,
  tyden: 5,
  certifikat: 50,
} as const;

/** Úrovně od nejnižší; `od` = kolik bodů je potřeba. */
export const UROVNE = [
  { nazev: "Začátečník", od: 0 },
  { nazev: "Student", od: 100 },
  { nazev: "Pokročilý", od: 300 },
  { nazev: "Expert", od: 600 },
  { nazev: "Mistr", od: 1000 },
] as const;

export interface Uroven {
  nazev: string;
  od: number;
  /** Další úroveň, nebo `null` u nejvyšší. */
  dalsi: { nazev: string; od: number } | null;
}

export function urovenZBodu(body: number): Uroven {
  let index = 0;
  for (const [i, uroven] of UROVNE.entries()) if (body >= uroven.od) index = i;
  const dalsi = UROVNE[index + 1];
  return {
    nazev: UROVNE[index]!.nazev,
    od: UROVNE[index]!.od,
    dalsi: dalsi ? { nazev: dalsi.nazev, od: dalsi.od } : null,
  };
}

/** Co klient udělal — z toho se body skládají. */
export interface ZaCoBody {
  lekce: number;
  kvizy: number;
  webinare: number;
  tydny: number;
  certifikaty: number;
}

export function secistBody(za: ZaCoBody): number {
  return (
    za.lekce * BODY.lekce +
    za.kvizy * BODY.kviz +
    za.webinare * BODY.webinar +
    za.tydny * BODY.tyden +
    za.certifikaty * BODY.certifikat
  );
}
