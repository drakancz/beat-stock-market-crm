import { z } from "zod";

import { zpracujOznameni } from "@/lib/platby/platby";
import {
  adresaVolajiciho,
  odpovedJson as odpoved,
  vytvorPocitadloNeuspechu,
} from "@/lib/verejne-api";

/**
 * Oznámení platební brány GoPay o změně platby — `GET` (i `POST`)
 * `/api/platby/gopay?id=<id platby>` (Jakub souhlasil 19. 10. 2026,
 * zapsáno v `security.md`).
 *
 * **Adresa bez přihlášení**, ale **zprávě se nevěří**: nese jen id platby.
 * CRM platbu musí znát (jinak nic) a její stav si zjistí přímo u GoPay
 * (`zpracujOznameni()`). Podvržené oznámení tak nic nezaplatí.
 * Neznámá id se počítají (30 za minutu z adresy, pak `429`).
 */

export const dynamic = "force-dynamic";

const neznama = vytvorPocitadloNeuspechu({ limit: 30, oknoMs: 60_000 });

async function obsluz(request: Request) {
  const odkud = adresaVolajiciho(request);
  const pokus = neznama.zaber(odkud);
  if (!pokus.povoleno) {
    const odpovedLimit = odpoved(429, { ok: false, chyba: "Příliš mnoho pokusů." });
    odpovedLimit.headers.set("Retry-After", String(pokus.zaSekund));
    return odpovedLimit;
  }

  const id = z
    .string()
    .regex(/^\d{1,30}$/)
    .safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return odpoved(400, { ok: false, chyba: "Chybí id platby." });

  try {
    const vysledek = await zpracujOznameni(id.data);
    if (!vysledek) return odpoved(404, { ok: false, chyba: "Neznámá platba." });
    neznama.vrat(odkud);
    return odpoved(200, { ok: true });
  } catch (chyba) {
    // GoPay oznámení zopakuje; do logu jen druh chyby.
    console.error("Oznámení GoPay selhalo:", chyba instanceof Error ? chyba.name : "neznámá");
    return odpoved(503, { ok: false, chyba: "Stav platby se nepodařilo ověřit." });
  }
}

export const GET = obsluz;
export const POST = obsluz;
