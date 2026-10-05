/**
 * Společné hodnoty pro sekci Objednávky.
 *
 * Vlastní soubor schválně: `actions.ts` má `"use server"` a takový modul
 * smí vyvážet **jen asynchronní funkce**. Konstanta v něm modul rozbije,
 * a to tiše — akce se pak nezavolá a v rozhraní se nestane vůbec nic.
 * Hlídá to `npm run kontrola:akce`.
 */

/** Položka výběru — filtr klientů jich víc nepotřebuje. */
export interface Volba {
  id: string;
  name: string;
}

/** Nejvíc produktů, které se vejdou do jedné objednávky z Landing Page. */
export const MAX_POLOZEK = 30;
