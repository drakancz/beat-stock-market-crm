import { odpovedManifestu } from "@/lib/aplikace";

/**
 * Manifest klientské části jako aplikace na ploše (krok 3A, 4. 10. 2026).
 * Telefon si ho stahuje bez přihlášení — nejsou v něm žádná data, jen
 * název, ikony a barvy (`src/lib/aplikace.ts`).
 */
export const dynamic = "force-static";

export function GET() {
  return odpovedManifestu("klient");
}
