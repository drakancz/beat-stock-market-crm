import { zapisChybu } from "@/lib/chyby";
import { JMENO_WEBHOOKU, hesloWebhooku } from "@/lib/smartemailing";
import { zpracujOdhlaseniZWebhooku } from "@/lib/smartemailing-synchronizace";
import { adresaVolajiciho, odpovedJson, stejneTajemstvi, vytvorPocitadlo } from "@/lib/verejne-api";

/**
 * Odhlášení ze SmartEmailingu — `POST /api/smartemailing/odhlaseni`
 * (Jakub, 15. 9. 2026).
 *
 * **Kdo sem smí:** jen SmartEmailing — webhook `unsubscribed_contact`, který
 * zakládá tlačítko v SmartEmailing → Nastavení propojení. Adresa je bez
 * přihlášení do CRM, proto:
 *
 * - **Prokazuje se jménem a heslem** (HTTP Basic). SmartEmailing zprávy
 *   nepodepisuje; heslo je v `.env` (`SMARTEMAILING_WEBHOOK_SECRET`) a když
 *   chybí, adresa nepřijímá nic.
 * - **Počítají se jen neúspěšné pokusy.** Po kampani může přijít hodně
 *   odhlášení najednou a žádné se nesmí ztratit. Zablokovat se tak nedá ani
 *   SmartEmailing — správné heslo projde vždy, i z adresy, ze které někdo
 *   zkoušel hesla.
 * - **Do logu nejde nic ze zprávy** (pravidlo 8), ani do sekce Chyby — tam
 *   jen důvod odmítnutí.
 * - **Odpověď neprozrazuje, koho CRM zná** — jen počty.
 */

// Heslo se čte z prostředí za běhu, ne při sestavení image.
export const dynamic = "force-dynamic";

/** Zpráva s kontakty je pár kilobajtů na kontakt; megabajt je velká rezerva. */
const MAX_TELO = 1_000_000;

/** Kolik neúspěšných pokusů z jedné adresy za minutu projde (10). */
const prilisMnohoPokusu = vytvorPocitadlo({ limit: 10, oknoMs: 60_000 });

/** „jméno:heslo" z hlavičky `Authorization: Basic …`. */
function udajeZHlavicky(request: Request): string | null {
  const autorizace = request.headers.get("authorization");
  if (!autorizace?.toLowerCase().startsWith("basic ")) return null;
  return Buffer.from(autorizace.slice(6).trim(), "base64").toString("utf8");
}

/**
 * Odmítnutí zprávy se správným heslem — zapíše se do sekce Chyby. Obsah
 * zprávy se neukládá, proto ji znovu spustit nejde.
 */
async function odmitni(status: number, chyba: string): Promise<Response> {
  await zapisChybu({ druh: "smartemailing.webhook", kod: String(status), detail: chyba });
  return odpovedJson(status, { ok: false, chyba });
}

export async function POST(request: Request) {
  const heslo = hesloWebhooku();
  if (!heslo) {
    return odpovedJson(503, { ok: false, chyba: "Příjem odhlášení není zapnutý." });
  }

  const zadane = udajeZHlavicky(request);
  if (!zadane || !stejneTajemstvi(zadane, `${JMENO_WEBHOOKU}:${heslo}`)) {
    if (prilisMnohoPokusu(adresaVolajiciho(request))) {
      return odpovedJson(429, { ok: false, chyba: "Příliš mnoho pokusů, zkus to za chvíli." });
    }
    return odpovedJson(401, { ok: false, chyba: "Neplatné přihlašovací údaje." });
  }

  const bajty = await request.arrayBuffer();
  if (bajty.byteLength > MAX_TELO) return odmitni(413, "Zpráva je příliš velká.");

  let telo: unknown;
  try {
    telo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bajty));
  } catch {
    return odmitni(400, "Zpráva není platný JSON v kódování UTF-8.");
  }

  let vysledek;
  try {
    vysledek = await zpracujOdhlaseniZWebhooku(telo);
  } catch (chyba) {
    // Jen druh chyby — hlášení z databáze může nést e-mail ze zprávy.
    console.error(
      "SmartEmailing: zpracování odhlášení selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return odmitni(500, "Odhlášení se nepodařilo zpracovat.");
  }

  if (!vysledek.ok) return odmitni(422, vysledek.chyba);
  return odpovedJson(200, vysledek);
}
