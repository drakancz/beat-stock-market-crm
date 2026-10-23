/**
 * Jazyk vstupu do aplikace (Jakub, 23. 10. 2026).
 *
 * Anglicky jdou přepnout **jen přihlašovací stránky, pruh ukázky
 * a průvodce ukázkou** — vstup pro zahraniční zájemce. Zbytek aplikace
 * zůstává česky. Přepínač je všude, nejen v ukázce.
 *
 * Volba žije v cookie `jazyk` (nastavuje ji `PrepinacJazyka` v prohlížeči).
 * Je to vstup od uživatele: cokoli jiného než `en` znamená češtinu.
 * Texty jsou v `texty-vstupu.ts`, čtení na serveru v `jazyk-server.ts`.
 */

export type Jazyk = "cs" | "en";

export const COOKIE_JAZYKA = "jazyk";

export function prectiJazyk(hodnota: string | null | undefined): Jazyk {
  return hodnota === "en" ? "en" : "cs";
}
