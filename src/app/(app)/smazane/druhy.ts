/**
 * Druhy záznamů, které se můžou objevit ve společném koši.
 *
 * Je to vlastní soubor schválně: soubor se serverovými akcemi
 * (`actions.ts`, `"use server"`) smí vyvážet **jen asynchronní funkce**.
 * Konstanta v něm celý modul rozbije — a co je horší, tiše: akce se pak
 * nezavolá a v rozhraní se nestane vůbec nic.
 */
export const DRUHY = [
  "klient",
  "objednavka",
  "produkt",
  "slevovy-kod",
  "doporucitel",
  "broker",
  "uzivatel",
] as const;

export type Druh = (typeof DRUHY)[number];
