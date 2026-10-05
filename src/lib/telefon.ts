/**
 * Jeden tvar telefonu v celém CRM: `+420 601 234 567` (Jakub, 26. 9. 2026).
 *
 * Do té doby se číslo ukládalo, jak kdo psal: formulář v CRM beze změny
 * („600 111 222"), leady a objednávky z webu bez mezer (`+420601234567`).
 * Teď se sjednocuje při každém uložení — klient, lead, objednávka i profil
 * uživatele — a starší záznamy převedla migrace
 * `20260926120000_jednotny_telefon`. **Její SQL dělá totéž co
 * `sjednotTelefon()`; když změníš jedno, změň i druhé.**
 *
 * - Mezery, pomlčky, tečky, lomítka a závorky se zahodí.
 * - `00` na začátku je totéž co `+` (`00420…` → `+420…`).
 * - Devět číslic bez předvolby je české číslo, dostane `+420`.
 * - Předvolba o třech číslicích a devět číslic (Česko, Slovensko…) se
 *   rozdělí po trojicích. Jiná délka (třeba německá čísla) zůstane
 *   `+49…` bez mezer — po trojicích by se rozdělila špatně.
 */

/** Jen číslice a úvodní `+`, s `00` převedeným na `+`. */
function holeCislo(zadany: string): string {
  const bezOddelovacu = zadany.trim().replace(/[\s\-./()]/g, "");
  return bezOddelovacu.startsWith("00") ? `+${bezOddelovacu.slice(2)}` : bezOddelovacu;
}

/**
 * Telefon v jednotném tvaru, nebo `null`, když to telefon není.
 *
 * ```ts
 * sjednotTelefon("601234567")          // „+420 601 234 567"
 * sjednotTelefon("00421 901-234-567")  // „+421 901 234 567"
 * sjednotTelefon("+4915112345678")     // „+4915112345678"
 * ```
 */
export function sjednotTelefon(zadany: string): string | null {
  let cislo = holeCislo(zadany);
  if (/^\d{9}$/.test(cislo)) cislo = `+420${cislo}`;
  if (!/^\+\d{9,15}$/.test(cislo)) return null;

  const trojice = /^\+(\d{3})(\d{3})(\d{3})(\d{3})$/.exec(cislo);
  return trojice ? `+${trojice.slice(1).join(" ")}` : cislo;
}

/**
 * Číslo bez mezer k porovnání: `+420 601 234 567` → `+420601234567`.
 * Slouží k hledání dvojníků; v databázi se porovnává se stejně očištěným
 * sloupcem (`regexp_replace(phone, '[^0-9+]', '', 'g')`).
 */
export function telefonKPorovnani(telefon: string): string {
  return telefon.replace(/[^\d+]/g, "");
}
