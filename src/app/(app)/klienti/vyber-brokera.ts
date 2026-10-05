/**
 * Společné hodnoty pro výběr brokera u klienta.
 *
 * Vlastní soubor schválně: `actions.ts` má `"use server"` a takový modul
 * smí vyvážet **jen asynchronní funkce**. Konstanta v něm shodí celý
 * modul — Next pak hlásí, že požadovaný export neexistuje, protože
 * v souboru nezůstane žádný.
 */

/** Hodnota ve výběru, která znamená „klient zatím žádného brokera nemá". */
export const BEZ_BROKERA = "zadny";

/** Broker tak, jak ho potřebuje výběr v dialogu — nic víc. */
export interface VolbaBrokera {
  id: string;
  name: string;
}
