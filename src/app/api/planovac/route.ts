import { upozorniNaKonecClenstvi } from "@/lib/klient/konec-clenstvi";
import { pripomenNezaplacene } from "@/lib/klient/pripominka-platby";
import { pripomenKonzultace } from "@/lib/konzultace";
import { pripomenWebinare } from "@/lib/vzdelavani/pripominka-webinare";
import { spustRanniPravidla } from "@/lib/pravidla";
import { jeUkazka } from "@/lib/ukazka";
import { obnovUkazkuJednouDenne } from "@/lib/ukazka-obnova";
import { spustVlastniPravidla } from "@/lib/vlastni-pravidla";
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
 * 2. **Připomínky nezaplacených objednávek** klientům (Fáze 5A,
 *    11. 10. 2026, `src/lib/klient/pripominka-platby.ts`). Úkoly pro tým
 *    (na prodloužení a s druhou připomínkou) zanikly 20. 10. 2026.
 * 3. **Připomínky webinářů** den a hodinu předem (Fáze 5C, 11. 10. 2026,
 *    `src/lib/vzdelavani/pripominka-webinare.ts`).
 * 4. **Připomínky konzultací** den předem (Fáze 5B, 19. 10. 2026,
 *    `src/lib/konzultace.ts`) — jen ráno.
 *
 * Všechno je bezpečné spustit vícekrát za den — ke každému konci,
 * objednávce i webináři odejde každá zpráva jen jednou.
 *
 * **Ranní úlohy (1, 2, 4 a pravidla) jen od `RANNI_HODINA` pražského času.** Kvůli
 * „hodinu předem“ u webinářů může plánovač běžet každých 15 minut; bez
 * téhle pojistky by klienti dostávali upozornění na konec členství
 * a platby po půlnoci. Webináře se hlídají při každém běhu. Testy si
 * hodinu snižují proměnnou `PLANOVAC_RANNI_HODINA`, ať projdou kdykoli.
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

/** Od kolika hodin (pražského času) běží ranní úlohy. Dnešní Cron je v 6:00/7:00. */
const RANNI_HODINA = 6;

/** Je už ráno? `PLANOVAC_RANNI_HODINA` jen pro testy (0 = kdykoli). */
function jeRano(ted = new Date()): boolean {
  const nastavena = Number(process.env.PLANOVAC_RANNI_HODINA);
  const od =
    Number.isInteger(nastavena) && nastavena >= 0 && nastavena <= 23 ? nastavena : RANNI_HODINA;
  const hodina = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(ted),
  );
  return hodina >= od;
}

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
    // Ukázka (src/lib/ukazka.ts): ráno jen obnova dat, žádné připomínky —
    // nikomu by stejně neodešly a vymyšleným klientům by jen přidaly úkoly.
    if (jeUkazka()) {
      if (!jeRano()) return odpoved(200, { ok: true, ukazka: true, ranniUlohy: false });
      return odpoved(200, { ok: true, ukazka: true, ...(await obnovUkazkuJednouDenne()) });
    }

    const webinare = await pripomenWebinare();
    if (!jeRano()) return odpoved(200, { ok: true, ranniUlohy: false, webinare });

    const konec = await upozorniNaKonecClenstvi();
    const platby = await pripomenNezaplacene();
    // Pravidla „když X, udělej Y“ (5D, 18. 10. 2026) — jen ráno.
    const pravidla = await spustRanniPravidla();
    // Vlastní pravidla (5D, 2. část, 19. 10. 2026) — taky jen ráno.
    const vlastniPravidla = await spustVlastniPravidla();
    const konzultace = await pripomenKonzultace();
    return odpoved(200, {
      ok: true,
      ranniUlohy: true,
      upozorneni: konec,
      pripominkyPlatby: platby,
      webinare,
      pravidla,
      konzultace,
      vlastniPravidla,
    });
  } catch (chyba) {
    console.error("Plánovač selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    return odpoved(500, { ok: false, chyba: "Plánovač se nepodařilo dokončit." });
  }
}
