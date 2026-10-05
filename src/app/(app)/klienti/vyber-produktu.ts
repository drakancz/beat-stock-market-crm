/**
 * Hodnota, kterou se ve výběru produktu myslí „o žádný konkrétní zájem nebyl".
 *
 * Prázdný řetězec komponenta `Select` neumí, proto zástupná hodnota.
 *
 * Vlastní soubor schválně: `actions.ts` má `"use server"` a takový modul
 * smí vyvážet **jen asynchronní funkce**. Konstanta v něm modul rozbije,
 * a to tiše. Hlídá to `npm run kontrola:akce`.
 */
export const BEZ_PRODUKTU = "zadny";
