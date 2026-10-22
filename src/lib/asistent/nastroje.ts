import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";

import { zaregistrujNastroje } from "@/lib/mcp/nastroje";
import type { Viewer } from "@/lib/session";

import { odkryjVstup, schovejData, schovejText, type Slovnik } from "./prezdivky";

/**
 * Nástroje asistenta AI (krok 4, Jakub 10. 10. 2026) — **tytéž jako MCP**
 * (`src/lib/mcp/nastroje.ts`), spuštěné uvnitř serveru přes spojení
 * v paměti. Platí tedy stejné dotazy, viditelnost i to, že nástroje
 * e-maily a telefony nečtou.
 *
 * **Jen čtení a bez volného textu.** Asistent dostane jen nástroje ze
 * seznamu níž: žádný zápis, žádné poznámky, přílohy ani úkoly
 * (v textu psaném lidmi bývají jména, která přezdívka nezachytí),
 * a nic o týmu (Aktivita, audit, Chyby, SmartEmailing).
 */
export const NASTROJE_ASISTENTA = [
  "hledat_klienty",
  "detail_klienta",
  "objednavky_klienta",
  "seznam_objednavek",
  "detail_objednavky",
  "cenik",
  "brokeri",
  "statistiky_objednavek",
  "prehled_clenstvi",
  "zdroje_klientu",
] as const;

export interface SpojeniSNastroji {
  nastroje: Anthropic.Beta.BetaTool[];
  zavolej(nazev: string, vstup: unknown): Promise<{ text: string; chyba: boolean }>;
  zavri(): Promise<void>;
}

export async function pripojNastroje(viewer: Viewer, slovnik: Slovnik): Promise<SpojeniSNastroji> {
  const server = new McpServer({ name: "crm-asistent", version: "1.0.0" });
  zaregistrujNastroje(server, viewer, { zapisovatAktivitu: false });

  const [proKlienta, proServer] = InMemoryTransport.createLinkedPair();
  const klient = new Client({ name: "crm-asistent", version: "1.0.0" });
  await Promise.all([server.connect(proServer), klient.connect(proKlienta)]);

  const povolene = new Set<string>(NASTROJE_ASISTENTA);
  const { tools } = await klient.listTools();

  return {
    nastroje: tools
      .filter((nastroj) => povolene.has(nastroj.name))
      .map((nastroj) => ({
        name: nastroj.name,
        description: schovejText(nastroj.description ?? nastroj.title ?? nastroj.name, slovnik)
          // Nástroje MCP mluví o „id klienta“ — tady je to přezdívka.
          .replaceAll("id klienta", "přezdívku klienta (K-XXXXXX)"),
        // `$schema` je značka verze JSON Schema z MCP, AI ji nepotřebuje.
        input_schema: Object.fromEntries(
          Object.entries(nastroj.inputSchema).filter(([klic]) => klic !== "$schema"),
        ) as Anthropic.Beta.BetaTool.InputSchema,
      })),

    async zavolej(nazev, vstup) {
      // Nástroj mimo seznam AI nedostala, ale prohlížeč ani AI se nevěří.
      if (!povolene.has(nazev)) return { text: "Tenhle nástroj asistent nemá.", chyba: true };

      const vysledek = await klient.callTool({
        name: nazev,
        arguments: odkryjVstup(vstup ?? {}, slovnik) as Record<string, unknown>,
      });
      const text = (Array.isArray(vysledek.content) ? vysledek.content : [])
        .map((cast) => (cast.type === "text" ? cast.text : ""))
        .join("\n");

      // Odpověď MCP je JSON; chyba nástroje je obyčejná věta.
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      const schovane = schovejData(data, slovnik);
      return {
        text: typeof schovane === "string" ? schovane : JSON.stringify(schovane),
        chyba: vysledek.isError === true,
      };
    },

    async zavri() {
      await Promise.allSettled([klient.close(), server.close()]);
    },
  };
}
