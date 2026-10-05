import { sestavCsv } from "@/lib/csv";
import { prectiFiltrHovoru } from "@/lib/filtry";
import { formatDatumCas } from "@/lib/format";
import { jakoDen } from "@/lib/obdobi";
import { nactiHovory } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { OUTCOME_LABEL } from "@/lib/types";

/**
 * Export hovorů do CSV.
 *
 * **Vyexportuje se přesně to, co má člověk na obrazovce** — stejný dotaz
 * (`nactiHovory()`), stejný rozsah role, stejné filtry z adresy.
 * Obchodník tedy dostane jen své klienty a soubor nikdy neobsahuje víc,
 * než na co má nárok (security_warnings.md, pravidlo 5).
 *
 * **Text poznámky v souboru není** (Jakub, 9. 9. 2026). Na počítání
 * a sestavy stačí datum, obchodník, klient, objednávka, výsledek a délka;
 * poznámka bývá o tom, co klient řekl — třeba o jeho penězích nebo
 * rodině — a stažený soubor už systém nehlídá. Kdo poznámku potřebuje,
 * otevře si hovor v aplikaci, kde platí omezení rolí
 * (security_warnings.md, pravidlo 8).
 *
 * Vlastní obsluha adresy, ne serverová akce: prohlížeč má soubor
 * stáhnout, ne překreslit stránku. Přihlášení se proto kontroluje tady —
 * rám `(app)` se na obsluhu adres nevztahuje.
 */
export async function GET(request: Request) {
  // Nepřihlášený nedostane ani prázdný soubor.
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  // Kdo má povinné dvoufázové ověření a nezapnul si ho, data nedostane
  // ani tudy — stejně jako přes obrazovky (`requireViewer()`).
  if (viewer.chybiDvoufazove)
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });

  const parametry = Object.fromEntries(new URL(request.url).searchParams.entries());
  const hovory = await nactiHovory(viewer, prectiFiltrHovoru(parametry));

  const csv = sestavCsv([
    ["Datum a čas", "Obchodník", "Klient", "Objednávka", "Výsledek", "Délka (min)"],
    ...hovory.map((hovor) => [
      formatDatumCas(hovor.at),
      hovor.userName,
      hovor.clientName,
      hovor.orderNumber ?? "",
      OUTCOME_LABEL[hovor.outcome],
      hovor.durationMin,
    ]),
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hovory-${jakoDen(new Date())}.csv"`,
      // Sestava s osobními údaji nemá co ležet v mezipaměti prohlížeče
      // ani na cestě (security_warnings.md, pravidlo 8).
      "Cache-Control": "no-store",
    },
  });
}
