import { zapisChybu } from "@/lib/chyby";
import { prijmiLead } from "@/lib/leady";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Příjem klientů z webu — `POST /api/leady` (Jakub, 12. 9. 2026).
 *
 * **Kdo sem smí:** kdokoli, kdo zná klíč. Je to jedna ze dvou adres
 * v systému dostupných bez přihlášení (druhá je odhlášení ze SmartEmailingu,
 * `POST /api/smartemailing/odhlaseni`), proto se tu hlídá víc než jinde:
 *
 * - **Klíč je v prostředí** (`LEAD_API_KEY`), nikdy v kódu ani v databázi
 *   (security_warnings.md, pravidlo 3). Když chybí, je kratší než 32 znaků
 *   nebo je to zástupná hodnota, endpoint nepřijímá vůbec nic — slabý klíč
 *   by jinak šel uhodnout.
 * - **Porovnává se v konstantním čase** přes otisky. Kdyby se klíče
 *   porovnávaly obyčejným `===`, dal by se uhodnout znak po znaku
 *   podle toho, jak dlouho odpověď trvá.
 * - **Počet volání je omezený.** Není to náhrada za reverzní proxy
 *   (pravidlo 10), jen první zábrana, než bude nasazená — bez ní by
 *   se dal klíč zkoušet donekonečna a databáze zaplnit smyšlenými leady.
 * - **Do logu nejde nic z těla požadavku** (pravidlo 8). Jméno, e-mail
 *   ani telefon klienta se nikam nevypisují.
 *
 * Vlastní obsluha je v `src/lib/leady.ts`.
 */

// Klíč se čte z prostředí za běhu, ne při sestavení image.
export const dynamic = "force-dynamic";

/** Delší tělo než tohle (v bajtech) nemůže být poctivý lead. */
const MAX_TELO = 4_000;

/** Kolik požadavků z jedné adresy za minutu projde (30). */
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
 * Odmítnutí leadu, který prošel kontrolou klíče — zapíše se do sekce Chyby
 * (Jakub, 15. 9. 2026). Uloží se jen důvod a stav odpovědi, **nic z těla
 * požadavku** (pravidlo 8), proto lead znovu spustit nejde.
 *
 * Pokusy se špatným klíčem a přetížení se nezapisují — jinak by sekci mohl
 * zaplnit kdokoli z internetu.
 */
async function odmitni(status: number, chyba: string): Promise<Response> {
  await zapisChybu({ druh: "lead.odmitnut", kod: String(status), detail: chyba });
  return odpoved(status, { ok: false, chyba });
}

export async function POST(request: Request) {
  const ocekavany = tajemstviZProstredi("LEAD_API_KEY");
  if (!ocekavany) {
    // Chyba nastavení, ne chyba volajícího — ale ven se to nevysvětluje.
    return odpoved(503, { ok: false, chyba: "Příjem leadů není zapnutý." });
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
   * Tělo se čte přísně jako UTF-8.
   *
   * Běžné `request.text()` neplatné bajty tiše nahradí otazníkem
   * v kosočtverci (�) — z „Tomáš Dvořák" se stane „Tom� Dvo��k" a
   * v CRM pak leží jméno, které nikdo neopraví, protože se neví, jak
   * znělo. Lepší je požadavek odmítnout: ten, kdo web zapojuje, se
   * o chybě dozví hned, ne za měsíc z rozbité karty klienta.
   */
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bajty);
  } catch {
    return odmitni(400, "Tělo požadavku není v kódování UTF-8. Pošli JSON jako UTF-8.");
  }

  // Poškozený text mohl vzniknout i dřív, na straně odesílatele — pak
  // je platně zakódovaný, ale znaky „náhrada" v něm zůstaly.
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
    vysledek = await prijmiLead(telo);
  } catch (chyba) {
    // Text chyby z databáze umí obsahovat i hodnoty z požadavku (třeba
    // e-mail u porušené jedinečnosti). Do logu jde proto jen druh chyby
    // (pravidlo 8) a ven obecná věta.
    console.error("Příjem leadu selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    return odmitni(500, "Lead se nepodařilo zpracovat.");
  }

  if (!vysledek.ok) return odmitni(400, vysledek.chyba);

  // 201 u nově založeného klienta, 200 když už ho známe — ať se to na
  // straně webu dá rozlišit i bez čtení těla odpovědi.
  return odpoved(vysledek.stav === "zalozen" ? 201 : 200, vysledek);
}
