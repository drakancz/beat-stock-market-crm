/**
 * E-mail z karty klienta a jeho šablony (Fáze 5D, Jakub 5. 11. 2026).
 *
 * Samostatný soubor **bez přístupu k databázi** — importuje ho i okno
 * v prohlížeči (délky polí, doplnění jména do náhledu).
 *
 * - Poslat smí každý přihlášený (`klienti/email-actions.ts`), i klientovi
 *   bez souhlasu s marketingem — je to osobní zpráva, ne kampaň.
 * - Šablony spravuje jen administrátor (`nastaveni/sablony/actions.ts`).
 * - Popis funkce: `docs/funkce/email-z-karty.md`.
 */

export const MAX_NAZEV_SABLONY = 80;
export const MAX_PREDMET = 200;
export const MAX_TEXT = 5000;

/**
 * Kolik e-mailů z karty smí jeden člověk poslat za hodinu. Pojistka proti
 * omylu (dvojklik, zaseknuté okno) i zneužití účtu — kampaně patří do
 * SmartEmailingu (security_warnings.md, pravidlo 8).
 */
export const LIMIT_ZA_HODINU = 30;

/** Zástupný text, za který se doplní celé jméno klienta. */
export const ZASTUPCE_JMENA = "{jmeno}";

/** Doplní jméno klienta za `{jmeno}` v předmětu i textu. */
export function doplnJmeno(text: string, jmeno: string): string {
  return text.split(ZASTUPCE_JMENA).join(jmeno);
}

export type StavEmailu = "ODESLANO" | "NEODESLANO";

export const POPIS_STAVU_EMAILU: Record<StavEmailu, string> = {
  ODESLANO: "odesláno",
  NEODESLANO: "neodesláno",
};
