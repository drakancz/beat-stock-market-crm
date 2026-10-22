/**
 * Druhy událostí na časové ose klienta (Fáze 5B, Jakub 16. 10. 2026).
 *
 * Samostatný soubor bez přístupu k databázi — importuje ho i okno
 * v prohlížeči (přepínače filtru).
 */

export const DRUHY_OSY = ["objednavky", "tym", "klient", "zmeny"] as const;

export type DruhOsy = (typeof DRUHY_OSY)[number];

export const POPIS_DRUHU_OSY: Record<DruhOsy, string> = {
  objednavky: "Objednávky",
  tym: "Tým",
  klient: "Klient",
  zmeny: "Změny",
};

/** Kolik událostí okno načte najednou. */
export const UDALOSTI_NA_STRANKU = 100;

/** Jedna řádka na ose — už připravená k zobrazení. */
export interface UdalostOsy {
  /** Jedinečné v rámci osy (zdroj + id záznamu + druh okamžiku). */
  id: string;
  druh: DruhOsy;
  /** Okamžik jako ISO text — slouží i jako značka pro „Načíst starší“. */
  kdy: string;
  /** Datum a čas v pražském čase, ať se v prohlížeči nic nepřepočítává. */
  cas: string;
  nadpis: string;
  popis: string | null;
  /** Kdo to udělal: kolega, nebo „klient“ / „CRM“ / „web“. */
  kdo: string | null;
}
