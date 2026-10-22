/**
 * Co se testuje i na telefonech (Jakub, 20. 10. 2026 — šetření minut na
 * GitHubu). Desktop (Chrome) pouští všechno; Android a iPhone jen:
 *
 * - testy se štítkem `@telefon` — každý, který kontroluje rozložení
 *   (`bezVodorovnehoPosuvu()`) nebo pracuje v klientské části,
 * - celé soubory níž: klientská část, přihlášení, rozložení všech
 *   obrazovek a zabezpečení (Safari se k hlavičkám chová jinak než Chrome).
 *
 * Do té doby běžel každý test ve všech třech prohlížečích; telefony braly
 * skoro 60 % minut sady a většinou opakovaly to, co desktop.
 */
export const STITEK_TELEFON = "@telefon";

export const SOUBORY_NA_TELEFONU = [
  "klientska-cast",
  "prehled-klienta",
  "koupit",
  "prihlaseni",
  "responzivita",
  "zabezpeceni",
];

/**
 * Filtr projektů `android` a `iphone`. Playwright ho porovnává s textem
 * „projekt soubor popis test štítky“, takže chytí štítek i název souboru.
 */
export const NA_TELEFONU = new RegExp(
  `${STITEK_TELEFON}|(?:^|[\\s/\\\\])(?:${SOUBORY_NA_TELEFONU.join("|")})\\.spec\\.ts`,
);

/** Běží test i na telefonech? Podle štítku nebo souboru. */
export function beziNaTelefonu(soubor: string, stitky: readonly string[]): boolean {
  return (
    stitky.includes(STITEK_TELEFON) ||
    SOUBORY_NA_TELEFONU.some((nazev) => soubor.replaceAll("\\", "/").endsWith(`/${nazev}.spec.ts`))
  );
}
