/**
 * Ukázkový režim (Jakub, 22. 10. 2026).
 *
 * CRM slouží jako živá ukázka pro zájemce o Jakubovy služby. Server se
 * zapnutým režimem (`UKAZKA=1`, nastavuje Jakub ručně na Railway) ukazuje
 * dva zkušební účty se známým heslem přímo na přihlašovací stránce, každou
 * noc vrátí data do výchozího stavu a nepustí nic ven — e-maily,
 * SmartEmailing, webhooky, Google Kalendář, AI, oznámení ani přílohy.
 *
 * **Vědomá výjimka z pravidla „heslo zadává jen sám uživatel“:** hesla
 * ukázkových účtů jsou veřejná schválně. Účty proto nesmí změnit heslo,
 * e-mail ani dvoufázové ověření (jinak by jeden návštěvník zamkl ostatní)
 * a ukázkový člen týmu nevidí Správu uživatelů.
 *
 * Mimo ukázkový režim tyhle účty neexistují — zakládá je až noční obnova
 * (`src/lib/ukazka-obnova.ts`), takže známé heslo na běžném serveru nic
 * neotevře.
 */

/** Je zapnutý ukázkový režim? Čte se za běhu, ne při sestavení. */
export function jeUkazka(): boolean {
  return process.env.UKAZKA === "1";
}

/** Zkušební člen týmu: administrátor bez Správy uživatelů. */
export const UKAZKOVY_TYM = {
  email: "ukazka@beatstockmarket.test",
  heslo: "Ukazka-tym-2026",
} as const;

/** Zkušební klient pro klientskou část. */
export const UKAZKOVY_KLIENT = {
  email: "klient.ukazka@example.test",
  heslo: "Ukazka-klient-2026",
} as const;

/** Hláška pro akci, kterou ukázka nepouští. */
export const VYPNUTO_V_UKAZCE = "V ukázce je tohle vypnuté — data jsou vymyšlená a nic neodchází ven.";

/** Je tohle ukázkový účet člena týmu? Bez ukázkového režimu nikdy. */
export function jeUkazkovyTym(email: string | null | undefined): boolean {
  return jeUkazka() && email?.toLowerCase() === UKAZKOVY_TYM.email;
}

/** Je tohle ukázkový účet klienta? Bez ukázkového režimu nikdy. */
export function jeUkazkovyKlient(email: string | null | undefined): boolean {
  return jeUkazka() && email?.toLowerCase() === UKAZKOVY_KLIENT.email;
}
