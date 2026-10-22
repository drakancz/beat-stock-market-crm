import type { ClientFieldKind } from "@/generated/prisma/enums";

/**
 * Vlastní pole u klienta (Fáze 5B, Jakub 18. 10. 2026) — druhy a tvar
 * hodnot bez přístupu k databázi, ať je použije formulář i server.
 *
 * Hodnota se ukládá jako text v jednotném tvaru: číslo `1234.5`, datum
 * `RRRR-MM-DD`, ano/ne `ano` / `ne`, výběr = přesně jedna z možností.
 */

export const DRUHY_POLI = ["TEXT", "CISLO", "DATUM", "ANO_NE", "VYBER"] as const;

export const POPIS_DRUHU: Record<ClientFieldKind, string> = {
  TEXT: "Text",
  CISLO: "Číslo",
  DATUM: "Datum",
  ANO_NE: "Ano / ne",
  VYBER: "Výběr z možností",
};

export const MAX_POLI = 30;
export const MAX_MOZNOSTI = 20;
export const MAX_NAZEV = 60;
export const MAX_MOZNOST = 60;
export const MAX_TEXT = 500;

/** Druhy, podle kterých jde filtrovat seznam klientů. */
export function jdeFiltrovat(kind: ClientFieldKind): boolean {
  return kind === "VYBER" || kind === "ANO_NE";
}

/**
 * Hodnota z formuláře v jednotném tvaru. Prázdná = `null` (hodnota se
 * smaže). Neplatná = `{ chyba }`.
 */
export function prectiHodnotu(
  pole: { kind: ClientFieldKind; options: string[]; name: string },
  vstup: string,
): { hodnota: string | null } | { chyba: string } {
  const text = vstup.trim();
  if (text === "") return { hodnota: null };

  switch (pole.kind) {
    case "TEXT":
      return text.length > MAX_TEXT
        ? { chyba: `${pole.name}: nejvýš ${MAX_TEXT} znaků.` }
        : { hodnota: text };
    case "CISLO": {
      const cislo = text.replace(/\s/g, "").replace(",", ".");
      if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(cislo)) {
        return { chyba: `${pole.name}: napiš číslo.` };
      }
      return { hodnota: String(Number(cislo)) };
    }
    case "DATUM": {
      const shoda = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (!shoda) return { chyba: `${pole.name}: datum není platné.` };
      const [rok, mesic, den] = [Number(shoda[1]), Number(shoda[2]), Number(shoda[3])];
      const datum = new Date(Date.UTC(rok, mesic - 1, den));
      const sedi =
        rok >= 1900 &&
        rok <= 2100 &&
        datum.getUTCFullYear() === rok &&
        datum.getUTCMonth() === mesic - 1 &&
        datum.getUTCDate() === den;
      return sedi ? { hodnota: text } : { chyba: `${pole.name}: datum není platné.` };
    }
    case "ANO_NE":
      return text === "ano" || text === "ne"
        ? { hodnota: text }
        : { chyba: `${pole.name}: vyber ano, nebo ne.` };
    case "VYBER":
      return pole.options.includes(text)
        ? { hodnota: text }
        : { chyba: `${pole.name}: vyber jednu z možností.` };
  }
}

/** Hodnota k zobrazení: číslo s čárkou, datum `18. 10. 2026`, Ano / Ne. */
export function zobrazHodnotu(kind: ClientFieldKind, hodnota: string): string {
  switch (kind) {
    case "CISLO":
      return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 4 }).format(Number(hodnota));
    case "DATUM": {
      const [rok, mesic, den] = hodnota.split("-").map(Number);
      return `${den}. ${mesic}. ${rok}`;
    }
    case "ANO_NE":
      return hodnota === "ano" ? "Ano" : "Ne";
    default:
      return hodnota;
  }
}

/** Filtr `pole=<id pole>:<hodnota>` v adrese seznamu klientů. */
export function filtrPole(id: string, hodnota: string): string {
  return `${id}:${hodnota}`;
}

export function prectiFiltrPole(text: string): { fieldId: string; value: string } | null {
  const dvojtecka = text.indexOf(":");
  if (dvojtecka < 1 || dvojtecka === text.length - 1) return null;
  return { fieldId: text.slice(0, dvojtecka), value: text.slice(dvojtecka + 1) };
}
