"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatPrice } from "@/lib/format";

/**
 * Grafy Dashboardu.
 *
 * **Barva nikdy nenese sama o sobě význam.** Kdo je který sloupec, říká
 * popisek u osy a číslo přímo u sloupce; odstín je navrch. Graf tak
 * zůstane čitelný i pro toho, kdo barvy nerozliší, a na černobílém tisku.
 * Odstíny samotné jsou v `src/app/globals.css` a jsou spočítané, ne
 * odhadnuté — viz komentář u `--chart-1`.
 *
 * Jedna hodnota = jedna osa. Počty a koruny se proto kreslí zvlášť,
 * nikdy dvě různá měřítka do jednoho obrázku.
 */

/** Stupnice jedné modré, od nejsvětlejší po nejtmavší. */
const STUPNICE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Pět nesouvisejících odstínů pro kategorie, které na sebe nenavazují. */
const KATEGORIE = [
  "var(--chart-kategorie-1)",
  "var(--chart-kategorie-2)",
  "var(--chart-kategorie-3)",
  "var(--chart-kategorie-4)",
  "var(--chart-kategorie-5)",
];

/** Jedna modrá pro grafy, kde odstín nemá co rozlišovat. */
const MODRA = "var(--chart-3)";

/** Krátká čísla na osu: `412 tis.` místo `412 300`. */
const kratce = new Intl.NumberFormat("cs-CZ", { notation: "compact", maximumFractionDigits: 1 });

const cely = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

export interface BodVyvoje {
  klic: string;
  popisek: string;
  hodnota: number;
  objednavky: number;
  hovory: number;
}

/** Cena nových objednávek v čase. */
export function GrafHodnoty({ data, mena }: { data: BodVyvoje[]; mena: string }) {
  const config = {
    hodnota: { label: `Cena objednávek (${mena})` },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="vypln-hodnoty" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MODRA} stopOpacity={0.35} />
            <stop offset="100%" stopColor={MODRA} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="popisek" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickMargin={4}
          tickFormatter={(hodnota: number) => kratce.format(hodnota)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="popisek"
              formatter={(hodnota) => formatPrice(Number(hodnota), mena)}
            />
          }
        />
        <Area
          dataKey="hodnota"
          type="monotone"
          stroke={MODRA}
          strokeWidth={2}
          fill="url(#vypln-hodnoty)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Počet hovorů v čase. Zvlášť od korun — jiné měřítko patří do jiného grafu. */
export function GrafHovoru({ data }: { data: BodVyvoje[] }) {
  const config = { hovory: { label: "Hovory" } } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="popisek" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={36} tickMargin={4} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent labelKey="popisek" />} />
        <Bar dataKey="hovory" fill={MODRA} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export interface RadekKategorie {
  label: string;
  pocet: number;
  /** Nepovinná částka — ukáže se v bublině u sloupce. */
  hodnota?: number;
}

/**
 * Čím se sloupce obarví.
 *
 * - `postup` — řádky na sebe navazují a jdou odněkud někam (stav objednávky).
 *   Stupnice se rozprostře od světlé k tmavé v pořadí řádků.
 * - `velikost` — řádky jsou seřazené od největšího (brokeři). Nejtmavší
 *   dostane ten největší, ať odstín říká totéž co délka sloupce.
 * - `kategorie` — řádky spolu nesouvisí (výsledek hovoru). Každý svůj odstín.
 * - `jedna` — odstín nemá co rozlišovat. Víc než pět kroků jedné modré už
 *   od sebe nikdo nerozezná, takže šestistupňový výčet dostane jednu barvu
 *   a rozlišuje se popiskem u osy.
 */
export type Odstineni = "postup" | "velikost" | "kategorie" | "jedna";

function barvaRadku(odstineni: Odstineni, poradi: number, celkem: number): string {
  if (odstineni === "jedna") return MODRA;
  // Odstíny se schválně **necyklí**: pátá kategorie by dostala barvu první
  // a vypadala by jako ona. Zatím je jediný takový výčet pětiprvkový
  // (výsledek hovoru); kdyby přibyl šestý, spadne na jednu modrou.
  if (odstineni === "kategorie") return KATEGORIE[poradi] ?? MODRA;

  // Stupnice se roztáhne přes všechny řádky, ať se využije celý rozsah
  // i u tří řádků a ať sousedi nikdy nesplynou.
  const krok = celkem <= 1 ? STUPNICE.length - 1 : (poradi * (STUPNICE.length - 1)) / (celkem - 1);
  const index = Math.round(krok);
  return STUPNICE[odstineni === "velikost" ? STUPNICE.length - 1 - index : index];
}

/**
 * Vodorovné sloupce podle kategorie: výsledek hovoru, stav objednávky, zdroj.
 *
 * Název kategorie stojí u osy a počet přímo u sloupce, takže se nic
 * nepozná jen podle odstínu.
 */
export function GrafKategorii({
  data,
  mena,
  popisPoctu,
  odstineni = "jedna",
}: {
  data: RadekKategorie[];
  mena?: string;
  popisPoctu: string;
  odstineni?: Odstineni;
}) {
  const config = { pocet: { label: popisPoctu } } satisfies ChartConfig;

  // Kus místa navíc vpravo, aby se číslo u nejdelšího sloupce vešlo.
  const maximum = Math.max(...data.map((radek) => radek.pocet), 1);

  return (
    <ChartContainer
      config={config}
      className="w-full"
      style={{ height: `${Math.max(140, data.length * 44 + 24)}px` }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 4, right: 32, top: 4, bottom: 4 }}
        barCategoryGap={10}
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[0, maximum]} hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={150}
          tickMargin={6}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(hodnota, _nazev, polozka) => {
                const radek = polozka?.payload as RadekKategorie | undefined;
                const castka =
                  mena && radek?.hodnota !== undefined
                    ? ` · ${formatPrice(radek.hodnota, mena)}`
                    : "";
                return `${cely.format(Number(hodnota))} ${popisPoctu}${castka}`;
              }}
            />
          }
        />
        <Bar
          dataKey="pocet"
          radius={4}
          // Barva podle pořadí řádku. Dřív přes `<Cell>`, který recharts
          // označily za zastaralý a ve verzi 4 odstraní.
          shape={(sloupec: BarShapeProps) => (
            <Rectangle {...sloupec} fill={barvaRadku(odstineni, sloupec.index, data.length)} />
          )}
        >
          <LabelList
            dataKey="pocet"
            position="right"
            offset={8}
            className="fill-foreground"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
