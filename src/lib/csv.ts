/**
 * Skládání souborů CSV pro export.
 *
 * Vlastní modul schválně: exportů bude časem víc a formát se má chovat
 * všude stejně. Navíc jde takhle ověřit samostatně, bez přihlašování.
 *
 * **Oddělovač je středník a na začátku stojí značka UTF-8** — obojí kvůli
 * českému Excelu, ne kvůli normě. S čárkou by Excel narval celý řádek do
 * jednoho sloupce a bez značky by z diakritiky udělal patvary.
 */

/** Oddělovač sloupců. Český Excel čeká středník. */
const ODDELOVAC = ";";

/** Excel pozná UTF-8 jen podle téhle značky na začátku souboru. */
const ZNACKA_UTF8 = "﻿";

/**
 * Jedna buňka.
 *
 * Uvozovky se zdvojují a celá hodnota se do uvozovek zabalí, takže
 * středník ani konec řádku uvnitř textu soubor nerozbijí.
 *
 * **Buňka začínající `=`, `+`, `-` nebo `@` dostane apostrof navíc.**
 * Excel by ji jinak vyhodnotil jako vzorec — je to známý způsob, jak
 * z tabulky spustit cizí příkaz na počítači toho, kdo si ji otevře.
 * Poznámka u hovoru je text od uživatele, takže sem takový vstup dojít
 * může (security_warnings.md, pravidlo 11).
 */
export function bunkaCsv(hodnota: string | number | null | undefined): string {
  const text = hodnota === null || hodnota === undefined ? "" : String(hodnota);
  const bezpecny = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${bezpecny.replaceAll('"', '""')}"`;
}

/**
 * Číslo tak, aby ho český Excel přečetl jako číslo.
 *
 * Desetinná čárka místo tečky a bez oddělovače tisíců — `1234.5` by
 * český Excel vzal jako text (nebo datum), `1 234,50` taky jako text.
 * Zaokrouhluje se na haléře.
 *
 * Záporné číslo by `bunkaCsv()` ošetřila apostrofem jako možný vzorec,
 * takže by z něj byl text. Exporty proto záporná čísla nepíšou — změnu
 * proti předchozímu období nechávají na Excelu.
 */
export function cisloCsv(hodnota: number): string {
  return String(Math.round(hodnota * 100) / 100).replace(".", ",");
}

/** Celý soubor: značka, hlavička a řádky oddělené `CRLF`, jak to Excel čeká. */
export function sestavCsv(radky: (string | number | null | undefined)[][]): string {
  const telo = radky.map((radek) => radek.map(bunkaCsv).join(ODDELOVAC)).join("\r\n");
  return `${ZNACKA_UTF8}${telo}\r\n`;
}
