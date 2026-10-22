import { odpovedMojichUdaju } from "@/lib/klient/moje-udaje";

export const dynamic = "force-dynamic";

/**
 * „Moje údaje“ ve strojově čitelné podobě (JSON) — 21. 10. 2026.
 * **Jen přihlášený klient a jen svoje údaje** (Jakub); tým ani
 * nepřihlášený se k nim nedostane. Obsah: `src/lib/klient/moje-udaje.ts`.
 */
export function GET() {
  return odpovedMojichUdaju("json");
}
