import { bezOsobnichUdaju } from "@/lib/anonymizace";

/**
 * Jak odpověď nástroje MCP odchází do AI.
 *
 * **Bez e-mailů a telefonů** (Jakub, 27. 9. 2026 — vědomá výjimka
 * z pravidla 8 je jen pro jména, objednávky a poznámky, ne pro kontakty).
 * Pojistky jsou dvě, ať jedna chyba nestačí:
 *
 * 1. nástroje e-mail ani telefon z databáze vůbec nečtou,
 * 2. tady se zahodí každé pole, které se jmenuje jako kontakt, a každý
 *    text projde `bezOsobnichUdaju()` — číslo nebo adresa, které někdo
 *    napsal do poznámky, se nahradí `[telefon]` / `[e-mail]`.
 *
 * Hlídá to `npm run kontrola:udaje` (`scripts/kontrola-anonymizace.ts`).
 * Soubor proto importuje jen anonymizaci — kontrola ho pouští mimo Next.
 */

/** Pole, která do odpovědi nesmí nikdy, ať je do ní kdokoli přidá. */
const ZAKAZANA_POLE = new Set(["email", "phone", "telefon", "mail", "emailova-adresa"]);

const PRAZSKY_CAS = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Okamžik jako pražský čas `RRRR-MM-DD HH:MM`.
 *
 * Server běží v UTC; kdyby odcházel čas v UTC, AI by psala o objednávce
 * „ve 22:00 předchozího dne" (stejný důvod jako `src/lib/format.ts`).
 */
export function casVPraze(okamzik: Date): string {
  return PRAZSKY_CAS.format(okamzik);
}

/** Text odpovědi — JSON bez kontaktů, časy v pražském čase. */
export function textOdpovedi(data: unknown): string {
  return JSON.stringify(
    data,
    function (klic: string, hodnota: unknown) {
      if (ZAKAZANA_POLE.has(klic.toLowerCase())) return undefined;
      // `JSON.stringify` volá `toJSON()` dřív než tuhle funkci, takže
      // datum přijde už jako text v UTC. Původní hodnota je v `this`.
      const puvodni = (this as Record<string, unknown>)[klic];
      if (puvodni instanceof Date) return casVPraze(puvodni);
      if (typeof hodnota === "string") return bezOsobnichUdaju(hodnota);
      return hodnota;
    },
    1,
  );
}

/** Výsledek nástroje ve tvaru, který čeká MCP. */
export function odpovedNastroje(data: unknown) {
  return { content: [{ type: "text" as const, text: textOdpovedi(data) }] };
}

/** Chyba nástroje — AI ji dostane jako text a může ji říct člověku. */
export function chybaNastroje(zprava: string) {
  return { content: [{ type: "text" as const, text: zprava }], isError: true };
}
