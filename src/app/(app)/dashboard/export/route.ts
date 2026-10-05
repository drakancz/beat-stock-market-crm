import { nactiPlneniCilu } from "@/lib/cile";
import { cisloCsv, sestavCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { jakoDen, krokProObdobi, prectiObdobi } from "@/lib/obdobi";
import { nactiDashboard } from "@/lib/queries";
import { getViewer } from "@/lib/session";

/** Jak se v souboru jmenuje krok vývoje v čase. */
const KROK_POPIS = { den: "Den", tyden: "Týden", mesic: "Měsíc" } as const;

/**
 * Export statistik z Dashboardu do CSV (Jakub, 23. 9. 2026).
 *
 * **Stáhnout smí každý přihlášený**, stejně jako Dashboard vidí každý
 * přihlášený. Nepřihlášený nedostane nic.
 *
 * **Jsou v něm jen součty, žádná jména klientů** (Jakub vybral „čísla
 * z Dashboardu", ne seznam objednávek). Soubor tedy neobsahuje osobní
 * údaje a nic, co by člověk neviděl na obrazovce.
 *
 * Čísla počítá **tentýž dotaz jako obrazovka** (`nactiDashboard()`,
 * `nactiPlneniCilu()`) nad tímtéž obdobím z adresy — soubor nemůže ukázat
 * jiná čísla než Dashboard. Všechny tabulky jsou v jednom listu pod sebou,
 * oddělené prázdným řádkem; částky jsou bez DPH jako všude v CRM.
 *
 * Vlastní obsluha adresy, ne serverová akce: prohlížeč má soubor
 * stáhnout. Rám `(app)` se na obsluhu adres nevztahuje, proto se
 * přihlášení i dvoufázové ověření kontrolují tady (vzor
 * `hovory/export/route.ts`).
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove)
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });

  // Období se čte stejně jako na obrazovce: nesmyslná hodnota z adresy
  // spadne na výchozích 30 dní (`prectiObdobi()`), soubor to pak říká
  // v řádku „Pozor".
  const parametry = Object.fromEntries(new URL(request.url).searchParams.entries());
  const obdobi = prectiObdobi(parametry);

  const [data, cile] = await Promise.all([nactiDashboard(viewer, obdobi), nactiPlneniCilu(viewer)]);

  const krok = krokProObdobi(obdobi.dnu);
  // `predchoziDo` je první okamžik po předchozím období, poslední den je o chvilku dřív.
  const predchoziPrvni = jakoDen(obdobi.predchoziOd);
  const predchoziPosledni = jakoDen(new Date(obdobi.predchoziDo.getTime() - 1));
  const { soucasnost: ted, minulost: drive } = data;

  const csv = sestavCsv([
    ["Statistiky CRM Beat Stock Market"],
    ["Období", `${formatDate(obdobi.prvniDen)} až ${formatDate(obdobi.posledniDen)}`],
    ["Předchozí období", `${formatDate(predchoziPrvni)} až ${formatDate(predchoziPosledni)}`],
    ["Částky", "Kč bez DPH"],
    ...(obdobi.odmitnutyRozsah
      ? [["Pozor", "Zadaný rozsah nešel použít, čísla jsou za posledních 30 dní."]]
      : []),
    [],

    ["Souhrn", "Za období", "Za předchozí období"],
    ["Objednávky (přijaté)", ted.objednavky, drive.objednavky],
    ["Cena objednávek", cisloCsv(ted.hodnota), cisloCsv(drive.hodnota)],
    ["Hovory (uskutečněné)", ted.hovory, drive.hovory],
    [],

    // Cíl se nastavuje po měsících, takže je vždycky za tento měsíc —
    // stejně jako na obrazovce, nezávisle na zvoleném období.
    [`Plnění cíle — ${cile.popis}`, "Tržby ze zaplacených objednávek", "Cíl", "Splněno (%)"],
    ...cile.radky.map((radek) => [
      radek.name,
      cisloCsv(radek.trzby),
      radek.cil > 0 ? cisloCsv(radek.cil) : "bez cíle",
      radek.cil > 0 ? Math.round((radek.trzby / radek.cil) * 100) : "",
    ]),
    [],

    ["Objednávky podle stavu", "Počet", "Cena"],
    ...data.objednavkyPodleStavu.map((stav) => [stav.label, stav.pocet, cisloCsv(stav.hodnota)]),
    [],

    ["Hovory podle výsledku", "Počet"],
    ...data.hovoryPodleVysledku.map((vysledek) => [vysledek.label, vysledek.pocet]),
    [],

    ["Noví klienti podle zdroje", "Počet"],
    ...(data.podleZdroje.length > 0
      ? data.podleZdroje.map((zdroj) => [zdroj.label, zdroj.pocet])
      : [["V období nepřibyl žádný klient.", 0]]),
    [],

    [`Vývoj v čase (${KROK_POPIS[krok].toLowerCase()})`, "Začátek", "Objednávky", "Cena", "Hovory"],
    ...data.vyvoj.map((bod) => [
      bod.popisek,
      bod.klic,
      bod.objednavky,
      cisloCsv(bod.hodnota),
      bod.hovory,
    ]),
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="statistiky-${obdobi.prvniDen}-az-${obdobi.posledniDen}.csv"`,
      // Firemní čísla nemají co ležet v mezipaměti prohlížeče ani na cestě.
      "Cache-Control": "no-store",
    },
  });
}
