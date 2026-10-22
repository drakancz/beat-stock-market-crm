/**
 * Události odchozích webhooků (Jakub, 19. 10. 2026). Samostatný soubor bez
 * databáze — čte ho i formulář v prohlížeči.
 */
export const UDALOSTI_WEBHOOKU = [
  "objednavka.nova",
  "objednavka.zaplacena",
  "klient.novy",
  "konzultace.rezervovana",
  "konzultace.prelozena",
  "konzultace.zrusena",
  "kurz.dokoncen",
] as const;

export type UdalostWebhooku = (typeof UDALOSTI_WEBHOOKU)[number];

export const POPIS_UDALOSTI: Record<UdalostWebhooku, string> = {
  "objednavka.nova": "Nová objednávka",
  "objednavka.zaplacena": "Zaplacená objednávka",
  "klient.novy": "Nový klient",
  "konzultace.rezervovana": "Rezervace konzultace",
  "konzultace.prelozena": "Přeložení konzultace",
  "konzultace.zrusena": "Zrušení konzultace",
  "kurz.dokoncen": "Dokončený kurz (certifikát)",
};

/** Nejvýš tolik webhooků najednou. */
export const NEJVIC_WEBHOOKU = 10;
