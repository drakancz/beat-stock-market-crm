import { upozorniNaKonecClenstvi } from "@/lib/klient/konec-clenstvi";
import { zalozUkolyNaProdlouzeni } from "@/lib/platnost";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  stejneTajemstvi,
  tajemstviZProstredi,
  vytvorPocitadloNeuspechu,
} from "@/lib/verejne-api";

/**
 * Denní plánovač — `POST /api/planovac` (krok 3A, Jakub 4. 10. 2026).
 *
 * Aplikace sama nic podle hodin nespouští (a na Railway se uspává), proto
 * ji jednou denně ráno zavolá malá plánovaná služba na Railway. Co se
 * při tom udělá:
 *
 * 1. **Upozornění klientům na konec členství** — týden předem a v den
 *    konce (`src/lib/klient/konec-clenstvi.ts`).
 * 2. **Úkoly na prodloužení** pro tým — do té doby vznikaly jen při
 *    otevření Dashboardu; to zůstává, plánovač jen zajistí, že nečekají.
 *
 * Obojí je bezpečné spustit vícekrát za den — ke každému konci vznikne
 * jen jedno upozornění a jeden úkol.
 *
 * **Kdo sem smí:** kdokoli, kdo zná klíč `PLANOVAC_KEY`. Je to adresa bez
 * přihlášení, zapsaná v `security.md` (Jakub souhlasil 4. 10. 2026):
 *
 * - klíč je jen v prostředí, aspoň 32 znaků; bez něj adresa nepřijímá nic;
 * - porovnává se v konstantním čase;
 * - špatný klíč se počítá (5 za 15 minut z adresy, pak `429`);
 * - tělo požadavku se nečte vůbec — zvenku se nedá nic předat, jen spustit
 *   to, co by se stejně spustilo ráno.
 */

export const dynamic = "force-dynamic";

const neuspechy = vytvorPocitadloNeuspechu({ limit: 5, oknoMs: 15 * 60_000 });

function klicZPozadavku(request: Request): string | null {
  const autorizace = request.headers.get("authorization");
  if (autorizace?.toLowerCase().startsWith("bearer ")) return autorizace.slice(7).trim();
  return null;
}

export async function POST(request: Request) {
  const ocekavany = tajemstviZProstredi("PLANOVAC_KEY");
  if (!ocekavany) return odpoved(503, { ok: false, chyba: "Plánovač není zapnutý." });

  const odkud = adresaVolajiciho(request);
  const pokus = neuspechy.zaber(odkud);
  if (!pokus.povoleno) {
    const odpovedLimit = odpoved(429, { ok: false, chyba: "Příliš mnoho pokusů." });
    odpovedLimit.headers.set("Retry-After", String(pokus.zaSekund));
    return odpovedLimit;
  }

  const zadany = klicZPozadavku(request);
  if (!zadany || !stejneTajemstvi(zadany, ocekavany)) {
    return odpoved(401, { ok: false, chyba: "Neplatný klíč." });
  }
  neuspechy.vrat(odkud);

  try {
    const konec = await upozorniNaKonecClenstvi();
    await zalozUkolyNaProdlouzeni();
    return odpoved(200, { ok: true, upozorneni: konec });
  } catch (chyba) {
    console.error("Plánovač selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    return odpoved(500, { ok: false, chyba: "Plánovač se nepodařilo dokončit." });
  }
}
