/**
 * České hlášky k přihlášení do klientské části. Klientům se **vyká**
 * (tým si tyká — `src/lib/auth-errors.ts`). Stejná pravidla: hláška nikdy
 * neprozradí, jestli e-mail v systému je, a říká, co s tím.
 */

const HLASKY: Record<string, string> = {
  spatne_prihlaseni: "Nesprávný e-mail nebo heslo.",
  spatny_kod: "Nesprávný kód. Zkontrolujte, že opisujete ten aktuální.",
  uzamceno: "Příliš mnoho neúspěšných pokusů. Účet je na 15 minut dočasně uzamčený.",
  prilis_mnoho_pokusu: "Příliš mnoho neúspěšných pokusů o přihlášení. Zkuste to znovu za 5 minut.",
};

export function chybaKlientaCesky(kod?: string | null): string {
  return (kod && HLASKY[kod]) || "Něco se nepovedlo. Zkuste to prosím znovu.";
}
