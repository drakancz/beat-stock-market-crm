import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Stitek } from "@/components/stitky/stitek";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";

import { smazStitek } from "./actions";
import { StitekDialog } from "./stitek-dialog";

export const metadata: Metadata = { title: "Štítky" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Štítky (Fáze 5B, Jakub 11. 10. 2026). **Vidí i mění jen
 * administrátor** (zábrana i v rámu `nastaveni/layout.tsx`). Klientům
 * štítky přidává každý přihlášený na kartě nebo hromadně v seznamu.
 */
export default async function StitkyPage() {
  await requireAdmin();

  const stitky = await db.clientTag.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { klienti: { where: { client: { deletedAt: null } } } } },
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Tags className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Štítky klientů
          </CardTitle>
          <CardDescription>
            Štítky přidává klientům celý tým — na kartě klienta nebo hromadně v seznamu klientů.
            Podle štítku jde seznam vyfiltrovat. Klient svoje štítky nikdy nevidí.
          </CardDescription>
        </div>
        <StitekDialog />
      </CardHeader>
      <CardContent>
        {stitky.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="Zatím žádný štítek."
            description="Založ první tlačítkem Nový štítek."
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border" aria-label="Štítky">
            {stitky.map((stitek) => (
              <li key={stitek.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Stitek nazev={stitek.name} barva={stitek.color} />
                <Link
                  href={`/klienti?stitek=${stitek.id}`}
                  className="text-muted-foreground min-w-0 flex-1 text-xs hover:underline"
                >
                  {pocet(stitek._count.klienti, "klient", "klienti", "klientů")}
                </Link>
                <div className="flex shrink-0 items-center">
                  <StitekDialog stitek={stitek} />
                  <SmazaniObsahu
                    maly
                    titulek="Smazat štítek"
                    nazev={stitek.name}
                    dusledky="Zmizí u všech klientů, kteří ho mají, i z uložených filtrů."
                    smazat={smazStitek.bind(null, stitek.id)}
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
