import { FlaskConical } from "lucide-react";

import { nactiJazyk } from "@/lib/jazyk-server";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Pruh „Ukázka“ nad obsahem (Jakub, 22. 10. 2026) — jen v ukázkovém
 * režimu (`src/lib/ukazka.ts`). Návštěvník má vědět, že data jsou
 * vymyšlená a že po něm v noci nic nezůstane. Česky nebo anglicky podle
 * přepínače (src/lib/jazyk.ts).
 */
export async function PruhUkazky() {
  if (!jeUkazka()) return null;
  const jazyk = await nactiJazyk();

  return (
    // `aside` je oblast stránky — čtečka obrazovky pruh zařadí (axe, 23. 10. 2026).
    <aside
      aria-label={jazyk === "en" ? "Demo" : "Ukázka"}
      lang={jazyk}
      className="bg-primary text-primary-foreground flex items-center justify-center gap-2 px-3 py-1.5 text-center text-xs sm:text-sm"
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>{TEXTY_VSTUPU[jazyk].pruh}</span>
    </aside>
  );
}
