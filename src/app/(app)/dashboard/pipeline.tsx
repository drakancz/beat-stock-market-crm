import { formatPrice } from "@/lib/format";
import { pocet } from "@/lib/mnozne";

/**
 * Pipeline — pruhy za stavy v pořadí, v jakém jdou v systému.
 *
 * Každý stupeň je pruh, jehož šířka odpovídá počtu. Stupně jdou v pořadí
 * výčtu, ne podle velikosti, ať je stav vždy na stejném místě.
 *
 * Procento „z předchozího" tu bylo do 26. 9. 2026. U objednávek nedávalo
 * smysl — zaplatit jde i bez kroku Nezaplaceno, takže vycházelo třeba
 * 200 %. Jakub ho nechal zrušit.
 *
 * Kreslí se obyčejným HTML, ne grafovou knihovnou: všechna čísla stojí
 * rovnou u pruhu, takže není na co najíždět myší a stránka si nemusí
 * kvůli tomu tahat další kód do prohlížeče.
 *
 * Barva nese pořadí ve stupnici, ne identitu — co je co, říká popisek
 * vedle. Odstíny jsou v `src/app/globals.css`.
 */

const STUPNICE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export interface StupenPipeline {
  label: string;
  pocet: number;
  /** Nepovinná částka — ukáže se pod počtem. */
  hodnota?: number;
}

export function Pipeline({
  stupne,
  mena,
  tvary,
}: {
  stupne: StupenPipeline[];
  mena?: string;
  /** Tvary počítaného slova pro popisek pruhu: 1 / 2–4 / 5 a víc. */
  tvary: [jeden: string, dva: string, pet: string];
}) {
  const nejvic = Math.max(...stupne.map((stupen) => stupen.pocet), 1);

  return (
    <ol className="space-y-2.5">
      {stupne.map((stupen, poradi) => {
        // Stupnice se roztáhne přes všechny stupně, ať se využije celá
        // a sousedi nikdy nesplynou.
        const krok =
          stupne.length <= 1
            ? STUPNICE.length - 1
            : Math.round((poradi * (STUPNICE.length - 1)) / (stupne.length - 1));

        // Prázdný stupeň dostane úzký proužek, ať je v trubce vidět mezera.
        const sirka = stupen.pocet === 0 ? 2 : Math.max(6, (stupen.pocet / nejvic) * 100);

        return (
          <li key={stupen.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">{stupen.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                {mena && stupen.hodnota !== undefined && stupen.hodnota > 0 && (
                  <span className="text-muted-foreground tabular text-xs">
                    {formatPrice(stupen.hodnota, mena)}
                  </span>
                )}
                <span className="tabular text-sm font-semibold">{stupen.pocet}</span>
              </span>
            </div>

            {/* Pruh je vystředěný, aby stupně dohromady daly tvar trubky. */}
            <div className="mt-1.5 flex justify-center">
              <div
                className="h-6 rounded-md transition-[width]"
                style={{ width: `${sirka}%`, backgroundColor: STUPNICE[krok] }}
                role="img"
                aria-label={`${stupen.label}: ${pocet(stupen.pocet, ...tvary)}`}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
