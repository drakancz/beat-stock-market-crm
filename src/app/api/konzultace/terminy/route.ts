import { terminyProWeb } from "@/lib/konzultace-z-webu";
import { jeUkazka } from "@/lib/ukazka";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Volné termíny konzultací pro Landing Page — `GET /api/konzultace/terminy`
 * (6H, Jakub souhlasil 27. 10. 2026; zapsané v `security.md`).
 *
 * **Jen v ukázkovém režimu** — jinak 404 dřív, než se cokoli ověřuje, ať
 * ostrý server adresu ani neprozradí. Chrání ji týž klíč `ORDER_API_KEY`
 * jako příjem objednávek (patří stejnému webu). Nic nezapisuje; ven jde
 * jen id, začátek a délka termínu (`src/lib/konzultace-z-webu.ts`).
 */

export const dynamic = "force-dynamic";

/** Kolik dotazů z jedné adresy za minutu projde. */
const prekrocenLimit = vytvorPocitadlo({ limit: 30, oknoMs: 60_000 });

function klicZPozadavku(request: Request): string | null {
  const hlavicka = request.headers.get("x-api-key");
  if (hlavicka) return hlavicka.trim();

  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();

  return null;
}

export async function GET(request: Request) {
  if (!jeUkazka()) return odpoved(404, { ok: false, chyba: "Nenalezeno." });

  const ocekavany = tajemstviZProstredi("ORDER_API_KEY");
  if (!ocekavany) {
    return odpoved(503, { ok: false, chyba: "Rezervace z webu nejsou zapnuté." });
  }

  if (prekrocenLimit(adresaVolajiciho(request))) {
    return odpoved(429, { ok: false, chyba: "Příliš mnoho požadavků, zkus to za chvíli." });
  }

  const zadany = klicZPozadavku(request);
  if (!zadany || !stejneTajemstvi(zadany, ocekavany)) {
    return odpoved(401, { ok: false, chyba: "Neplatný klíč." });
  }

  try {
    return odpoved(200, { ok: true, terminy: await terminyProWeb() });
  } catch (chyba) {
    console.error(
      "Načtení termínů pro web selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return odpoved(500, { ok: false, chyba: "Termíny se nepodařilo načíst." });
  }
}
