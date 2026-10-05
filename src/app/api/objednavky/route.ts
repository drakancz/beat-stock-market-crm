import { zapisChybu } from "@/lib/chyby";
import { prijmiObjednavku } from "@/lib/objednavky";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Příjem objednávek z Landing Page — `POST /api/objednavky`
 * (Jakub, 22. 9. 2026).
 *
 * **Kdo sem smí:** kdokoli, kdo zná klíč. Je to třetí adresa v systému
 * dostupná bez přihlášení (vedle příjmu leadů a odhlášení ze
 * SmartEmailingu), a je zapsaná v `security.md`. Proto se tu hlídá víc
 * než jinde — postup je stejný jako u leadů:
 *
 * - **Klíč je v prostředí** (`ORDER_API_KEY`), nikdy v kódu ani
 *   v databázi (security_warnings.md, pravidlo 3). Když chybí, je kratší
 *   než 32 znaků nebo je to zástupná hodnota, endpoint nepřijímá vůbec
 *   nic.
 * - **Vlastní klíč, ne ten od leadů.** Kdyby se jeden vyzradil, druhá
 *   cesta do CRM zůstane zavřená.
 * - **Porovnává se v konstantním čase** přes otisky, aby se klíč nedal
 *   uhodnout znak po znaku podle doby odpovědi.
 * - **Počet volání je omezený.** Není to náhrada za reverzní proxy
 *   (pravidlo 10), jen první zábrana — bez ní by se dal klíč zkoušet
 *   donekonečna.
 * - **Cena se z požadavku nebere.** Objednávka říká jen co a kolik kusů;
 *   kolik to stojí, ví CRM z ceníku. Jinak by šlo podvrženým požadavkem
 *   koupit kurz za korunu.
 * - **Do logu nejde nic z těla požadavku** (pravidlo 8).
 *
 * Vlastní obsluha je v `src/lib/objednavky.ts`.
 */

// Klíč se čte z prostředí za běhu, ne při sestavení image.
export const dynamic = "force-dynamic";

/** Delší tělo než tohle (v bajtech) nemůže být poctivá objednávka. */
const MAX_TELO = 8_000;

/** Kolik požadavků z jedné adresy za minutu projde (30), stejně jako u leadů. */
const prekrocenLimit = vytvorPocitadlo({ limit: 30, oknoMs: 60_000 });

/** Klíč z hlavičky `X-API-Key`, nebo z `Authorization: Bearer …`. */
function klicZPozadavku(request: Request): string | null {
  const hlavicka = request.headers.get("x-api-key");
  if (hlavicka) return hlavicka.trim();

  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();

  return null;
}

/**
 * Odmítnutí objednávky, která prošla kontrolou klíče — zapíše se do
 * sekce Chyby. Uloží se jen důvod a stav odpovědi, **nic z těla
 * požadavku** (pravidlo 8), proto objednávku znovu spustit nejde.
 *
 * Pokusy se špatným klíčem a přetížení se nezapisují — jinak by sekci
 * mohl zaplnit kdokoli z internetu.
 */
async function odmitni(status: number, chyba: string): Promise<Response> {
  await zapisChybu({ druh: "objednavka.odmitnuta", kod: String(status), detail: chyba });
  return odpoved(status, { ok: false, chyba });
}

export async function POST(request: Request) {
  const ocekavany = tajemstviZProstredi("ORDER_API_KEY");
  if (!ocekavany) {
    // Chyba nastavení, ne chyba volajícího — ale ven se to nevysvětluje.
    return odpoved(503, { ok: false, chyba: "Příjem objednávek není zapnutý." });
  }

  if (prekrocenLimit(adresaVolajiciho(request))) {
    return odpoved(429, { ok: false, chyba: "Příliš mnoho požadavků, zkus to za chvíli." });
  }

  const zadany = klicZPozadavku(request);
  if (!zadany || !stejneTajemstvi(zadany, ocekavany)) {
    return odpoved(401, { ok: false, chyba: "Neplatný klíč." });
  }

  const bajty = await request.arrayBuffer();
  if (bajty.byteLength > MAX_TELO) {
    return odmitni(413, "Požadavek je příliš velký.");
  }

  /*
   * Tělo se čte přísně jako UTF-8 — stejně jako u leadů. Běžné
   * `request.text()` by vadné bajty tiše nahradilo otazníkem
   * v kosočtverci a v CRM by pak ležela objednávka s rozbitým jménem.
   */
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bajty);
  } catch {
    return odmitni(400, "Tělo požadavku není v kódování UTF-8. Pošli JSON jako UTF-8.");
  }

  if (text.includes("�")) {
    return odmitni(400, "V textu jsou poškozené znaky (�). Zkontroluj, že web posílá UTF-8.");
  }

  let telo: unknown;
  try {
    telo = JSON.parse(text);
  } catch {
    return odmitni(400, "Tělo požadavku není platný JSON.");
  }

  let vysledek;
  try {
    vysledek = await prijmiObjednavku(telo);
  } catch (chyba) {
    // Text chyby z databáze umí obsahovat i hodnoty z požadavku. Do logu
    // jde proto jen druh chyby (pravidlo 8) a ven obecná věta.
    console.error(
      "Příjem objednávky selhal:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return odmitni(500, "Objednávku se nepodařilo zpracovat.");
  }

  if (!vysledek.ok) return odmitni(400, vysledek.chyba);

  return odpoved(201, vysledek);
}
