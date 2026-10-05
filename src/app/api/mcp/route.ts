import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after } from "next/server";

import { klicZHlavicky, overKlic, poznamenejPouziti } from "@/lib/mcp/klice";
import { instrukceServeru, zaregistrujNastroje } from "@/lib/mcp/nastroje";
import {
  adresaVolajiciho,
  odpovedJson,
  vytvorPocitadlo,
  vytvorPocitadloNeuspechu,
} from "@/lib/verejne-api";

/**
 * MCP server CRM — `POST /api/mcp` (Jakub, 27. 9. 2026).
 *
 * **Oprávnění:**
 * - **vidět** smí jen ten, kdo pošle platný klíč z Mého profilu
 *   (`Authorization: Bearer crm_…`); data dostane přesně v rozsahu
 *   majitele klíče (security_warnings.md, pravidlo 4),
 * - **měnit** smí jen klíč se zaškrtnutým „smí zapisovat“ (Jakub,
 *   5. 10. 2026), a jen tři věci: přidat poznámku ke klientovi, založit
 *   úkol a odškrtnout úkol. Mazání ani úpravy přes MCP nejdou nikdy,
 *   klíč jen ke čtení nástroje pro zápis vůbec nedostane,
 * - **nepřihlášený** bez klíče dostane `401`.
 *
 * Adresa nemá sezení v prohlížeči, proto je v tabulce adres bez
 * přihlášení v `security.md`. Klíč tu nahrazuje přihlášení a ověřuje se
 * při každém požadavku (`overKlic()`), včetně role a smazání majitele.
 *
 * Server je **bez stavu**: každý požadavek dostane vlastní instanci
 * svázanou s majitelem klíče a po odpovědi zanikne. Nic se nedrží
 * v paměti mezi požadavky, takže nevadí restart ani víc kopií aplikace.
 */

/** Špatné klíče z jedné adresy — stejně jako u webhooku SmartEmailingu. */
const neuspechy = vytvorPocitadloNeuspechu({ limit: 10, oknoMs: 60_000 });

/** Volání na jeden platný klíč. AI umí v jedné odpovědi zavolat víc nástrojů. */
const volaniNaKlic = vytvorPocitadlo({ limit: 60, oknoMs: 60_000 });

/** Největší tělo požadavku. Dotaz na nástroj má pár set bajtů. */
const MAX_TELO = 64 * 1024;

function chybaJsonRpc(status: number, zprava: string, hlavicky: Record<string, string> = {}) {
  const odpoved = odpovedJson(status, {
    jsonrpc: "2.0",
    error: { code: -32001, message: zprava },
    id: null,
  });
  for (const [nazev, hodnota] of Object.entries(hlavicky)) odpoved.headers.set(nazev, hodnota);
  return odpoved;
}

export async function POST(request: Request) {
  const odkud = adresaVolajiciho(request);

  const pokus = neuspechy.zaber(odkud);
  if (!pokus.povoleno) {
    return chybaJsonRpc(429, "Příliš mnoho neplatných pokusů. Zkus to za chvíli.", {
      "Retry-After": String(pokus.zaSekund),
    });
  }

  const klic = klicZHlavicky(request.headers);
  const overeni = klic ? await overKlic(klic) : null;

  if (!overeni?.ok) {
    // Důvod jde jen do logu serveru — odpověď je vždy stejná, ať se z ní
    // nedá poznat, jestli klíč kdysi existoval nebo komu patřil.
    console.warn("MCP: odmítnutý klíč —", overeni ? overeni.duvod : "chybí nebo má špatný tvar");
    return chybaJsonRpc(401, "Chybí platný klíč. Vytvoř si ho v CRM v Mém profilu.");
  }

  // Platný klíč se do neúspěchů nepočítá.
  neuspechy.vrat(odkud);

  if (volaniNaKlic(overeni.klicId)) {
    return chybaJsonRpc(429, "Příliš mnoho dotazů za minutu. Zkus to za chvíli.", {
      "Retry-After": "60",
    });
  }

  after(() => poznamenejPouziti(overeni.klicId));

  const server = new McpServer(
    { name: "crm-beatstockmarket", version: "1.0.0" },
    { instructions: instrukceServeru(overeni.viewer, overeni.smiZapisovat) },
  );
  zaregistrujNastroje(server, overeni.viewer, { smiZapisovat: overeni.smiZapisovat });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_TELO,
  });

  try {
    await server.connect(transport);
    const odpoved = await transport.handleRequest(request);

    // Tělo se přečte celé dřív, než se server zavře — odpověď je JSON,
    // ne proud, takže se nic neztratí.
    const telo = await odpoved.text();
    const hlavicky = new Headers(odpoved.headers);
    // Odpověď nese jména klientů a jejich objednávky; nemá co ležet
    // v mezipaměti na cestě (pravidlo 8).
    hlavicky.set("Cache-Control", "no-store");

    return new Response(telo || null, { status: odpoved.status, headers: hlavicky });
  } finally {
    await transport.close();
    await server.close();
  }
}

/** Server je bez stavu — proud událostí (GET) ani ukončení sezení (DELETE) nemá. */
function nepodporovano() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export const GET = nepodporovano;
export const DELETE = nepodporovano;
