/**
 * Odstranění osobních údajů z textu, který opouští aplikaci.
 *
 * Do logů, chybových hlášení ani do žádné služby mimo počítač nepatří
 * e-maily, telefony ani obsah portfolia (security_warnings.md, pravidlo 8).
 * Text chyby přitom osobní údaj snadno nese — třeba odpověď cizí služby
 * („Contact jan.novak@example.cz is blacklisted") nebo dotaz s parametry.
 *
 * Používá to sekce Chyby (`src/lib/chyby.ts`) i hlášení do Sentry
 * (`src/lib/sentry/nastaveni.ts`). Soubor proto nesmí nic importovat —
 * běží i v prohlížeči.
 *
 * **Raději začerní víc než míň.** Když se do `[číslo]` občas schová
 * i částka, nic se neděje; opačná chyba je únik osobního údaje.
 */

/** E-mailová adresa v jakémkoli textu. */
const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g;

/** Telefon s mezinárodní předvolbou: `+420601234567`, `+420 601 234 567`. */
const TELEFON_MEZINARODNI = /\+\d{1,3}(?:[\s -]?\d){6,14}/g;

/** Devítimístné číslo, případně po trojicích — český mobil bez předvolby. */
const TELEFON_CESKY = /\b\d{3}[\s -]?\d{3}[\s -]?\d{3}\b/g;

/** Text bez e-mailových adres. */
export function bezEmailovychAdres(text: string): string {
  return text.replace(EMAIL, "[e-mail]");
}

/** Text bez telefonních čísel. */
export function bezTelefonnichCisel(text: string): string {
  return text.replace(TELEFON_MEZINARODNI, "[telefon]").replace(TELEFON_CESKY, "[telefon]");
}

/** Text bez e-mailů i telefonů. */
export function bezOsobnichUdaju(text: string): string {
  return bezTelefonnichCisel(bezEmailovychAdres(text));
}
