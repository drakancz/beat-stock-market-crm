import { FlaskConical } from "lucide-react";

import { jeUkazka } from "@/lib/ukazka";

/**
 * Pruh „Ukázka“ nad obsahem (Jakub, 22. 10. 2026) — jen v ukázkovém
 * režimu (`src/lib/ukazka.ts`). Návštěvník má vědět, že data jsou
 * vymyšlená a že po něm v noci nic nezůstane.
 */
export function PruhUkazky() {
  if (!jeUkazka()) return null;

  return (
    <div
      role="note"
      className="bg-primary text-primary-foreground flex items-center justify-center gap-2 px-3 py-1.5 text-center text-xs sm:text-sm"
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>
        Ukázka — data jsou vymyšlená a každou noc se vrátí do výchozího stavu. Nic neodchází ven.
      </span>
    </div>
  );
}
