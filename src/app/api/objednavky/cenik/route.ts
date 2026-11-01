import { cenikProWeb } from "@/lib/cenik-webu";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Ceník pro Landing Page — `GET /api/objednavky/cenik` (krok 1A, Jakub
 * souhlasil 25. 10. 2026; zapsané v `security.md`).
 *
 * Web si načte aktuální nabídku, aby ceny na stránce seděly s CRM. **Nic
 * se nezapisuje** a nic o klientech se nevrací — obsah je v
 * `src/lib/cenik-webu.ts`.
 *
 * Hlídá se stejně jako příjem objednávek: **týž klíč `ORDER_API_KEY`**
 * (patří stejnému webu), porovnání v konstantním čase, nejvýš 30 dotazů za
 * minutu z adresy. Vlastní počítadlo — načítání ceníku nemá ubírat z limitu
 * objednávek.
 */

export const dynamic = "force-dynamic";

const prekrocenLimit = vytvorPocitadlo({ limit: 30, oknoMs: 60_000 });

function klicZPozadavku(request: Request): string | null {
  const hlavicka = request.headers.get("x-api-key");
  if (hlavicka) return hlavicka.trim();

  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();

  return null;
}

export async function GET(request: Request) {
  const ocekavany = tajemstviZProstredi("ORDER_API_KEY");
  if (!ocekavany) {
    return odpoved(503, { ok: false, chyba: "Příjem objednávek není zapnutý." });
  }

  if (prekrocenLimit(adresaVolajiciho(request))) {
    return odpoved(429, { ok: false, chyba: "Příliš mnoho požadavků, zkus to za chvíli." });
  }

  const zadany = klicZPozadavku(request);
  if (!zadany || !stejneTajemstvi(zadany, ocekavany)) {
    return odpoved(401, { ok: false, chyba: "Neplatný klíč." });
  }

  try {
    return odpoved(200, { ok: true, produkty: await cenikProWeb() });
  } catch (chyba) {
    console.error("Načtení ceníku selhalo:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    return odpoved(500, { ok: false, chyba: "Ceník se nepodařilo načíst." });
  }
}
