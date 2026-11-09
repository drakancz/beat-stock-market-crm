import type { Metadata } from "next";
import { Mail } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";

import { smazSablonu } from "./actions";
import { SablonaDialog } from "./sablona-dialog";

export const metadata: Metadata = { title: "Šablony e-mailů" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Šablony e-mailů (Fáze 5D, Jakub 5. 11. 2026). **Vidí i mění
 * jen administrátor** (zábrana i v rámu `nastaveni/layout.tsx`). Použít
 * šablonu v okně Poslat email na kartě klienta smí každý přihlášený.
 */
export default async function SablonyPage() {
  await requireAdmin();

  const sablony = await db.emailTemplate.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, subject: true, body: true },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Mail className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Šablony e-mailů
          </CardTitle>
          <CardDescription>
            Připravené texty pro tlačítko Poslat email na kartě klienta. Použít je může celý tým,
            před odesláním je jde upravit. Hromadné kampaně patří do SmartEmailingu.
          </CardDescription>
        </div>
        <SablonaDialog />
      </CardHeader>
      <CardContent>
        {sablony.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Zatím žádná šablona."
            description="Založ první tlačítkem Nová šablona."
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border" aria-label="Šablony e-mailů">
            {sablony.map((sablona) => (
              <li key={sablona.id} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{sablona.name}</p>
                  <p className="text-muted-foreground text-xs break-words">
                    Předmět: {sablona.subject}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <SablonaDialog sablona={sablona} />
                  <SmazaniObsahu
                    maly
                    titulek="Smazat šablonu"
                    nazev={sablona.name}
                    dusledky="Z výběru v okně Poslat email zmizí. E-maily, které už podle ní odešly, zůstanou v historii klientů."
                    smazat={smazSablonu.bind(null, sablona.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
