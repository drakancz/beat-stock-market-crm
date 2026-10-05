/**
 * České státní a ostatní svátky, kdy se nepracuje (zákon č. 245/2000 Sb.).
 *
 * Počítají se, neukládají: pevná data jsou každý rok stejná a Velikonoce
 * se dopočítají. Vlastní volno firmy je v databázi (`CompanyDayOff`).
 *
 * Datum se všude předává jako text `RRRR-MM-DD` — kalendářní den, ne
 * okamžik. Tak se nepoplete s časovým pásmem (viz `src/lib/obdobi.ts`).
 */

const PEVNE: [mesic: number, den: number, nazev: string][] = [
  [1, 1, "Den obnovy samostatného českého státu a Nový rok"],
  [5, 1, "Svátek práce"],
  [5, 8, "Den vítězství"],
  [7, 5, "Den slovanských věrozvěstů Cyrila a Metoděje"],
  [7, 6, "Den upálení mistra Jana Husa"],
  [9, 28, "Den české státnosti"],
  [10, 28, "Den vzniku samostatného československého státu"],
  [11, 17, "Den boje za svobodu a demokracii"],
  [12, 24, "Štědrý den"],
  [12, 25, "1. svátek vánoční"],
  [12, 26, "2. svátek vánoční"],
];

export interface Svatek {
  /** `RRRR-MM-DD` */
  datum: string;
  nazev: string;
}

const DEN = 86_400_000;

const jakoText = (okamzik: number) => new Date(okamzik).toISOString().slice(0, 10);

/**
 * Velikonoční neděle podle gregoriánského kalendáře (anonymní
 * algoritmus, známý jako Meeus/Jones/Butcher). Vrací okamžik půlnoci UTC.
 */
function velikonocniNedele(rok: number): number {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesic = Math.floor((h + l - 7 * m + 114) / 31);
  const den = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(rok, mesic - 1, den);
}

/** Všechny svátky roku, seřazené podle data. */
export function svatkyRoku(rok: number): Svatek[] {
  const nedele = velikonocniNedele(rok);

  return [
    ...PEVNE.map(([mesic, den, nazev]) => ({
      datum: jakoText(Date.UTC(rok, mesic - 1, den)),
      nazev,
    })),
    { datum: jakoText(nedele - 2 * DEN), nazev: "Velký pátek" },
    { datum: jakoText(nedele + DEN), nazev: "Velikonoční pondělí" },
  ].sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Svátek v daný den, jinak `null`. */
export function svatekDne(datum: string): string | null {
  const rok = Number(datum.slice(0, 4));
  return svatkyRoku(rok).find((svatek) => svatek.datum === datum)?.nazev ?? null;
}

/** Den v týdnu: 1 = pondělí … 7 = neděle. */
export function denVTydnu(datum: string): number {
  const [rok, mesic, den] = datum.split("-").map(Number);
  const nedeleNula = new Date(Date.UTC(rok, mesic - 1, den)).getUTCDay();
  return nedeleNula === 0 ? 7 : nedeleNula;
}

export const DNY_V_TYDNU: { cislo: number; nazev: string; kratce: string }[] = [
  { cislo: 1, nazev: "pondělí", kratce: "Po" },
  { cislo: 2, nazev: "úterý", kratce: "Út" },
  { cislo: 3, nazev: "středa", kratce: "St" },
  { cislo: 4, nazev: "čtvrtek", kratce: "Čt" },
  { cislo: 5, nazev: "pátek", kratce: "Pá" },
  { cislo: 6, nazev: "sobota", kratce: "So" },
  { cislo: 7, nazev: "neděle", kratce: "Ne" },
];
