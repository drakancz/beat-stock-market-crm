import { overSlevovyKod } from "@/lib/objednavky";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Ověření slevového kódu z Landing Page — `POST /api/objednavky/kod`
 * (Fáze 5A, Jakub souhlasil 14. 10. 2026; zapsané v `security.md`).
 *
 * Web se zeptá, jestli kód platí a kolik ze zvolených produktů ubere,
 * a ukáže to zákazníkovi před objednáním. **Nic se nezapisuje** — kód se
 * „spotřebuje“ až objednávkou na `POST /api/objednavky`, která ho ověří
 * znovu.
 *
 * Hlídá se stejně jako příjem objednávek: **týž klíč `ORDER_API_KEY`**
 * (patří stejnému webu), porovnání v konstantním čase, omezený počet
 * volání. Vlastní počítadlo — zkoušení kódů nemá ubírat z limitu
 * objednávek. Do logu ani do Chyb nejde nic z těla požadavku (pravidlo 8).
 */

export const dynamic = "force-dynamic";

/** Kód, pár produktů a e-mail se vejdou i s velkou rezervou. */
const MAX_TELO = 8_000;

/** Kolik dotazů z jedné adresy za minutu projde. */
const prekrocenLimit = vytvorPocitadlo({ limit: 30, oknoMs: 60_000 });

function klicZPozadavku(request: Request): string | null {
  const hlavicka = request.headers.get("x-api-key");
  if (hlavicka) return hlavicka.trim();

  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();

  return null;
}

export async function POST(request: Request) {
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

  const bajty = await request.arrayBuffer();
  if (bajty.byteLength > MAX_TELO) {
    return odpoved(413, { ok: false, chyba: "Požadavek je příliš velký." });
  }

  let telo: unknown;
  try {
    telo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bajty));
  } catch {
    return odpoved(400, { ok: false, chyba: "Tělo požadavku není platný JSON v UTF-8." });
  }

  try {
    const vysledek = await overSlevovyKod(telo);
    return odpoved(vysledek.ok ? 200 : 400, vysledek);
  } catch (chyba) {
    console.error(
      "Ověření slevového kódu selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return odpoved(500, { ok: false, chyba: "Kód se nepodařilo ověřit." });
  }
}
