import { Award } from "lucide-react";

import { formatDatum } from "@/lib/format";
import type { Odznak } from "@/lib/vzdelavani/odznaky";

/**
 * Mřížka odznaků klienta (krok 3C) — v klientské části i na kartě klienta.
 * `sPopisem` = věta pro klienta („Dokončili jste…").
 */
export function SeznamOdznaku({ odznaky, sPopisem }: { odznaky: Odznak[]; sPopisem?: boolean }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Odznaky">
      {odznaky.map((odznak, i) => (
        <li key={i} className="flex items-start gap-3 rounded-md border p-3">
          <Award className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              {odznak.nazev}
              {odznak.kurz && (
                <span className="text-muted-foreground font-normal"> · {odznak.kurz}</span>
              )}
            </p>
            {sPopisem && <p className="text-muted-foreground text-xs">{odznak.popis}</p>}
            <p className="text-muted-foreground text-xs">{formatDatum(odznak.kdy)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
