import { pocet } from "@/lib/mnozne";

/** Pruh s postupem v kurzu: „7 z 12 lekcí". */
export function Postup({ hotovo, celkem }: { hotovo: number; celkem: number }) {
  const procent = celkem === 0 ? 0 : Math.round((hotovo / celkem) * 100);

  return (
    <div className="space-y-1.5">
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={celkem}
        aria-valuenow={hotovo}
        aria-label="Postup v kurzu"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${procent}%` }} />
      </div>
      <p className="text-muted-foreground text-xs">
        Hotovo {hotovo} z {pocet(celkem, "lekce", "lekcí", "lekcí")}
      </p>
    </div>
  );
}
