import Anthropic from "@anthropic-ai/sdk";

import { db } from "@/lib/db";
import { dnesniZacatek } from "@/lib/platnost";
import type { Viewer } from "@/lib/session";
import { casVPraze } from "@/lib/mcp/vystup";
import { jeUkazka } from "@/lib/ukazka";

import { pripojNastroje } from "./nastroje";
import { nactiSlovnik, rozdelOdpoved, schovejText, type CastOdpovedi } from "./prezdivky";

/**
 * Asistent AI v CRM (krok 4, Jakub 10. 10. 2026).
 *
 * - **Jen administrátor** — hlídá to stránka i akce (`requireAdmin()`).
 * - **Klienti pod přezdívkou** (`prezdivky.ts`): k Anthropicu nejdou
 *   jména, e-maily, telefony ani poznámky.
 * - **Jen čtení**, nástroje stejné jako MCP (`nastroje.ts`).
 * - **Rozhovor se neukládá.** Žije v okně prohlížeče; do Aktivity jde
 *   jen „Dotaz na asistenta AI“ s názvy použitých nástrojů.
 * - **Nejvýš 20 otázek za pražský den** na člověka, podle Aktivity.
 * - **Claude Sonnet 5.5** (Jakub vybral kvůli ceně), opakující se úvod
 *   (nástroje, pravidla) v mezipaměti. Odmítnutý dotaz Anthropic sám
 *   zkusí jiným modelem (`fallbacks: "default"`).
 *
 * Bez `ANTHROPIC_API_KEY` je asistent vypnutý a nic neodchází.
 */

export const MODEL_ASISTENTA = "claude-sonnet-5-5";
export const DENNI_LIMIT = 20;
/** Kolik kol „AI zavolá nástroj → dostane výsledek“ smí jedna otázka mít. */
const NEJVIC_KOL = 8;

export function asistentZapnuty(): boolean {
  // Ukázka nepošle ven nic (src/lib/ukazka.ts), ani otázky k Anthropicu.
  if (jeUkazka()) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function zbyvaOtazek(viewer: Viewer): Promise<number> {
  const dnes = await db.userEvent.count({
    where: { userId: viewer.id, kind: "ASISTENT", at: { gte: dnesniZacatek() } },
  });
  return Math.max(0, DENNI_LIMIT - dnes);
}

export interface ZpravaRozhovoru {
  role: "user" | "assistant";
  text: string;
}

export type VysledekOtazky =
  | { ok: true; text: string; casti: CastOdpovedi[]; zbyva: number }
  | { ok: false; chyba: string; zbyva: number };

function pravidla(): string {
  return [
    "Jsi asistent v interním CRM firmy Beat Stock Market, která prodává kurzy, členství a konzultace o investování.",
    "Ptá se tě administrátor CRM. Odpovídej česky, stručně a věcně, tykej.",
    "Data máš jen z nástrojů. Když nestačí, řekni to; nic si nevymýšlej.",
    "Klienti jsou v datech pod přezdívkou ve tvaru K-XXXXXX. Jejich jména nemáš a nehádej je. " +
      "V odpovědi piš přezdívku přesně tak, jak je — CRM ji uživateli ukáže jako jméno klienta s odkazem.",
    "E-maily, telefony a poznámky klientů záměrně nemáš.",
    "Jsi jen pro čtení: nic neměníš. Když tě uživatel požádá o změnu, řekni mu, kde v CRM ji udělá.",
    "Nedávej investiční doporučení.",
    "Částky jsou v Kč a bez DPH, pokud není řečeno jinak. Časy jsou v pražském čase.",
    "Piš prostý text bez Markdownu (žádné hvězdičky, mřížky ani tabulky). Seznam piš jako řádky začínající pomlčkou.",
  ].join("\n");
}

/**
 * Jedna otázka: limit, zápis do Aktivity, smyčka s nástroji. Volá ji
 * serverová akce po `requireAdmin()`; `zpravy` jsou ověřené zodem.
 */
export async function zeptejSe(viewer: Viewer, zpravy: ZpravaRozhovoru[]): Promise<VysledekOtazky> {
  const zbyva = await zbyvaOtazek(viewer);
  if (!asistentZapnuty()) {
    return { ok: false, chyba: "Asistent AI zatím není zapnutý.", zbyva };
  }
  if (zbyva === 0) {
    return {
      ok: false,
      chyba: `Dnešní limit ${DENNI_LIMIT} otázek je vyčerpaný. Zítra zase.`,
      zbyva: 0,
    };
  }

  // Zápis hned, ať se počítá i otázka, která pak selže (zaplatila se).
  const udalost = await db.userEvent.create({
    data: { userId: viewer.id, kind: "ASISTENT", detail: "otázka" },
    select: { id: true },
  });

  const slovnik = await nactiSlovnik();
  const spojeni = await pripojNastroje(viewer, slovnik);
  const pouzite = new Set<string>();

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000 });
    const system = `${pravidla()}\nDnes je ${casVPraze(new Date()).slice(0, 10)}.`;

    // Historie z prohlížeče jde ven zase jen bez jmen a kontaktů.
    const zpravyProAI: Anthropic.Beta.BetaMessageParam[] = zpravy.map((zprava) => ({
      role: zprava.role,
      content: schovejText(zprava.text, slovnik),
    }));

    for (let kolo = 0; kolo < NEJVIC_KOL; kolo++) {
      const odpoved = await anthropic.beta.messages.create({
        model: MODEL_ASISTENTA,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        system,
        tools: spojeni.nastroje,
        messages: zpravyProAI,
      });

      if (odpoved.stop_reason === "refusal") {
        return { ok: false, chyba: "Na tohle asistent neodpoví.", zbyva: zbyva - 1 };
      }

      if (odpoved.stop_reason === "tool_use") {
        zpravyProAI.push({ role: "assistant", content: odpoved.content });
        const volani = odpoved.content.filter(
          (blok): blok is Anthropic.Beta.BetaToolUseBlock => blok.type === "tool_use",
        );
        const vysledky = await Promise.all(
          volani.map(async (blok): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
            pouzite.add(blok.name);
            const { text, chyba } = await spojeni.zavolej(blok.name, blok.input);
            return { type: "tool_result", tool_use_id: blok.id, content: text, is_error: chyba };
          }),
        );
        zpravyProAI.push({ role: "user", content: vysledky });
        continue;
      }

      if (odpoved.stop_reason === "pause_turn") {
        zpravyProAI.push({ role: "assistant", content: odpoved.content });
        continue;
      }

      const text = odpoved.content
        .filter((blok): blok is Anthropic.Beta.BetaTextBlock => blok.type === "text")
        .map((blok) => blok.text)
        .join("")
        .trim();
      const doplnek =
        odpoved.stop_reason === "max_tokens" ? "\n\n(Odpověď je zkrácená — byla moc dlouhá.)" : "";
      const vysledek = (text || "Asistent nevrátil žádnou odpověď.") + doplnek;
      return {
        ok: true,
        text: vysledek,
        casti: rozdelOdpoved(vysledek, slovnik),
        zbyva: zbyva - 1,
      };
    }

    return {
      ok: false,
      chyba: "Otázka byla na asistenta moc složitá. Zkus ji rozdělit na menší.",
      zbyva: zbyva - 1,
    };
  } catch (chyba) {
    // Do logu jen druh chyby — hlášení může nést kus požadavku.
    console.error("Asistent AI selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    return { ok: false, chyba: popisChyby(chyba), zbyva: zbyva - 1 };
  } finally {
    await spojeni.zavri();
    await db.userEvent
      .update({
        where: { id: udalost.id },
        data: { detail: pouzite.size ? [...pouzite].join(", ") : "bez nástrojů" },
      })
      .catch(() => undefined);
  }
}

function popisChyby(chyba: unknown): string {
  if (chyba instanceof Anthropic.AuthenticationError) {
    return "Klíč k Anthropicu nefunguje. Zkontroluj ANTHROPIC_API_KEY.";
  }
  if (chyba instanceof Anthropic.PermissionDeniedError) {
    return "Klíč k Anthropicu na tohle nemá oprávnění.";
  }
  if (chyba instanceof Anthropic.RateLimitError) {
    return "Asistent je teď přetížený nebo došel kredit u Anthropicu. Zkus to za chvíli.";
  }
  if (chyba instanceof Anthropic.APIConnectionError) {
    return "Asistent teď neodpovídá. Zkus to za chvíli.";
  }
  if (chyba instanceof Anthropic.APIError) {
    return "Asistent teď nemůže odpovědět. Zkus to za chvíli.";
  }
  return "Něco se pokazilo. Zkus to prosím znovu.";
}
