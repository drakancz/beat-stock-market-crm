import { cisloCsv, sestavCsv } from "@/lib/csv";
import { formatDatum, formatDatumCas } from "@/lib/format";
import { jakoDen } from "@/lib/obdobi";
import { idZAdresy } from "@/lib/parametry";
import { nactiKlienta, nactiObjednavky } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { ORDER_STATUS_LABEL, PROGRAM_ACCESS_LABEL } from "@/lib/types";

/**
 * Objednávky jednoho klienta do CSV — tlačítko v okně Objednávky na
 * kartě klienta (Jakub, 23. 9. 2026).
 *
 * **Stáhnout smí každý přihlášený, kdo vidí kartu klienta** (dnes všichni).
 * Nepřihlášený nedostane nic. Klient mimo rozsah i neexistující klient
 * vrací stejně 404 — z odpovědi se nedá poznat, co v systému je.
 *
 * Řádek na objednávku s cenou **bez DPH i s DPH** (Jakub vybral obojí)
 * a na konci Celkem. Smazané objednávky v souboru nejsou — hlídá to
 * `nactiObjednavky()`, stejný dotaz jako okno na kartě.
 *
 * Vlastní obsluha adresy, ne serverová akce: prohlížeč má soubor
 * stáhnout. Rám `(app)` se na obsluhu adres nevztahuje, proto se
 * přihlášení i dvoufázové ověření kontrolují tady (vzor
 * `hovory/export/route.ts`).
 */
export async function GET(_request: Request, { params }: RouteContext<"/klienti/[id]/objednavky">) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove)
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });

  const id = idZAdresy((await params).id);
  // Viditelnost je v dotazu — klient mimo rozsah se prostě nenajde.
  const klient = id ? await nactiKlienta(viewer, id) : null;
  if (!klient) return new Response("Nenalezeno.", { status: 404 });

  const objednavky = await nactiObjednavky(viewer, { klientId: klient.id });

  // Celkem zvlášť za každou měnu — sčítat koruny s eury by byl nesmysl.
  // Dnes je ceník jen v korunách, takže vyjde jeden řádek.
  const celkem = new Map<string, { bezDph: number; sDph: number; pocet: number }>();
  for (const objednavka of objednavky) {
    const radek = celkem.get(objednavka.currency) ?? { bezDph: 0, sDph: 0, pocet: 0 };
    radek.bezDph += objednavka.hodnota;
    radek.sDph += objednavka.hodnotaSDph;
    radek.pocet += 1;
    celkem.set(objednavka.currency, radek);
  }

  const csv = sestavCsv([
    ["Objednávky klienta", klient.name],
    ["E-mail", klient.email],
    // Přístup je od 23. 9. 2026 jeden za klienta, ne u objednávky.
    ["Přístup do programu", PROGRAM_ACCESS_LABEL[klient.programAccess]],
    ["Staženo", formatDatum(new Date())],
    [],
    [
      "Datum a čas",
      "Objednávka",
      "Produkty",
      "Cena bez DPH",
      "Cena s DPH",
      "Měna",
      "Stav",
      "Zaplaceno",
    ],
    ...objednavky.map((objednavka) => [
      formatDatumCas(objednavka.createdAt),
      objednavka.number,
      objednavka.produkty
        .map((produkt) =>
          produkt.quantity > 1 ? `${produkt.name} (${produkt.quantity}×)` : produkt.name,
        )
        .join(", "),
      cisloCsv(objednavka.hodnota),
      cisloCsv(objednavka.hodnotaSDph),
      objednavka.currency,
      ORDER_STATUS_LABEL[objednavka.status],
      objednavka.paidAt ? formatDatum(objednavka.paidAt) : "",
    ]),
    ...[...celkem.entries()].map(([mena, soucet]) => [
      "Celkem",
      `Počet objednávek: ${soucet.pocet}`,
      "",
      cisloCsv(soucet.bezDph),
      cisloCsv(soucet.sDph),
      mena,
    ]),
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Jméno klienta do názvu souboru nejde — diakritika v hlavičce by se
      // v části prohlížečů rozsypala. Stačí datum; jméno je v souboru.
      "Content-Disposition": `attachment; filename="objednavky-klienta-${jakoDen(new Date())}.csv"`,
      // Sestava s osobními údaji nemá co ležet v mezipaměti prohlížeče
      // ani na cestě (security_warnings.md, pravidlo 8).
      "Cache-Control": "no-store",
    },
  });
}
