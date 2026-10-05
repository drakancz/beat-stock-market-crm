/**
 * České hlášky k chybám z přihlašování.
 *
 * Dvě zásady:
 *
 * 1. **Hláška nikdy neprozradí, jestli e-mail v systému existuje.** Kdyby
 *    přihlášení odpovědělo „takový uživatel neexistuje", šlo by přes
 *    formulář zjistit, kdo u vás pracuje. Špatný e-mail i špatné heslo
 *    proto vracejí tutéž větu.
 * 2. **Hláška říká, co s tím** — ne jen že něco selhalo.
 *
 * Kódy pocházejí z `src/lib/auth.ts` (vlastní chyby přihlášení) a od
 * Auth.js (obecné stavy).
 */

const HLASKY: Record<string, string> = {
  // Vlastní kódy z přihlašování.
  spatne_prihlaseni: "Nesprávný e-mail nebo heslo.",
  spatny_kod: "Nesprávný kód. Zkontroluj, že opisuješ ten aktuální.",
  uzamceno: `Příliš mnoho neúspěšných pokusů. Účet je na 15 minut dočasně uzamčený.`,
  // Omezení v `src/app/api/auth/[...nextauth]/route.ts`.
  prilis_mnoho_pokusu: "Příliš mnoho neúspěšných pokusů o přihlášení. Zkus to znovu za 5 minut.",

  // Obecné stavy Auth.js.
  CredentialsSignin: "Nesprávný e-mail nebo heslo.",
  AccessDenied: "K tomuto účtu nemáš přístup.",
  SessionRequired: "Přihlášení vypršelo. Přihlas se prosím znovu.",
  Configuration: "Přihlašování není správně nastavené. Dej vědět správci systému.",
};

const NAHRADNI = "Něco se nepovedlo. Zkus to prosím znovu.";

export function chybaCesky(kod?: string | null): string {
  if (kod && HLASKY[kod]) return HLASKY[kod];
  // Neznámá chyba: původní text je anglicky a mohl by prozradit vnitřní
  // podrobnosti, proto obecná česká věta.
  return NAHRADNI;
}
