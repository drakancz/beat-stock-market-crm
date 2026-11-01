import { prijmiRezervaciZWebu } from "@/lib/konzultace-z-webu";
import { jeUkazka } from "@/lib/ukazka";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadlo,
} from "@/lib/verejne-api";

/**
 * Úvodní konzultace zdarma z Landing Page — `POST /api/konzultace/rezervace`
 * (6H, Jakub souhlasil 27. 10. 2026; zapsané v `security.md`).
 *
 * **Jen v ukázkovém režimu** — jinak 404 dřív, než se cokoli ověřuje.
 * Klíč `ORDER_API_KEY` (drží ho skript Workeru, ne prohlížeč), porovnání
 * v konstantním čase, přísné UTF-8 a malý limit — každá rezervace může
 * založit klienta. Do logu nejde nic z těla požadavku (pravidlo 8).
 * Logika je v `src/lib/konzultace-z-webu.ts`.
 */

export const dynamic = "force-dynamic";

/** Jméno, e-mail a id termínu se vejdou s velkou rezervou. */
const MAX_TELO = 2_000;

/** Kolik rezervací z jedné adresy za minutu projde. */
const prekrocenLimit = vytvorPocitadlo({ limit: 10, oknoMs: 60_000 });

function klicZPozadavku(request: Request): string | null {
  const hlavicka = request.headers.get("x-api-key");
  if (hlavicka) return hlavicka.trim();

  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();

  return null;
}

export async function POST(request: Request) {
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

  const bajty = await request.arrayBuffer();
  if (bajty.byteLength > MAX_TELO) {
    return odpoved(413, { ok: false, chyba: "Požadavek je příliš velký." });
  }

  let telo: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bajty);
    if (text.includes("�")) throw new Error("poškozené znaky");
    telo = JSON.parse(text);
  } catch {
    return odpoved(400, { ok: false, chyba: "Tělo požadavku není platný JSON v UTF-8." });
  }

  try {
    const vysledek = await prijmiRezervaciZWebu(telo);
    if (!vysledek.ok) return odpoved(vysledek.status, { ok: false, chyba: vysledek.chyba });
    return odpoved(201, vysledek);
  } catch (chyba) {
    console.error(
      "Rezervace z webu selhala:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return odpoved(500, { ok: false, chyba: "Rezervaci se nepodařilo zapsat." });
  }
}
