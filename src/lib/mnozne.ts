/**
 * Počítané podstatné jméno ve správném tvaru.
 *
 * Čeština má u počtů tři tvary — „1 klient", „2 klienti", „5 klientů" —
 * a systém, který napíše „1 klientů", vypadá jako nedodělaný. Anglická
 * knihovna to neumí, je to pár řádků, tak si to píšeme sami.
 *
 * ```ts
 * pocet(1, "klient", "klienti", "klientů") // „1 klient"
 * pocet(3, "klient", "klienti", "klientů") // „3 klienti"
 * pocet(0, "klient", "klienti", "klientů") // „0 klientů"
 * ```
 */
export function tvar(cislo: number, jeden: string, dva: string, pet: string): string {
  const kolik = Math.abs(cislo);
  if (kolik === 1) return jeden;
  if (kolik >= 2 && kolik <= 4) return dva;
  return pet;
}

/** Totéž i s číslem: `2 klienti`. */
export function pocet(cislo: number, jeden: string, dva: string, pet: string): string {
  return `${cislo} ${tvar(cislo, jeden, dva, pet)}`;
}
