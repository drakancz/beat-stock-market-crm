import type { Metadata } from "next";
import { ListPlus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";
import { POPIS_DRUHU } from "@/lib/vlastni-pole-druhy";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";

import { smazPole } from "./actions";
import { PoleDialog, PosunPole } from "./pole-dialog";

export const metadata: Metadata = { title: "Vlastní pole" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Vlastní pole (Fáze 5B, Jakub 18. 10. 2026). **Vidí i mění
 * jen administrátor** (zábrana i v rámu `nastaveni/layout.tsx`). Hodnoty
 * u klientů vyplňuje každý přihlášený na kartě klienta.
 */
export default async function VlastniPolePage() {
  await requireAdmin();

  const pole = await db.clientField.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      options: true,
      _count: { select: { hodnoty: { where: { client: { deletedAt: null } } } } },
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <ListPlus className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Vlastní pole u klienta
          </CardTitle>
          <CardDescription>
            Údaje navíc, které CRM samo nemá — třeba zkušenost s investováním. Vyplňuje je celý tým
            na kartě klienta; podle výběru a ano/ne jde filtrovat seznam klientů. Klient je nikdy
            nevidí.
          </CardDescription>
        </div>
        <PoleDialog />
      </CardHeader>
      <CardContent>
        {pole.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title="Zatím žádné vlastní pole."
            description="Založ první tlačítkem Nové pole."
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border" aria-label="Vlastní pole">
            {pole.map((p, poradi) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{p.name}</p>
                  <p className="text-muted-foreground text-xs break-words">
                    {POPIS_DRUHU[p.kind]}
                    {p.kind === "VYBER" && `: ${p.options.join(", ")}`} · vyplněno u{" "}
                    {pocet(p._count.hodnoty, "klienta", "klientů", "klientů")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <PosunPole
                    id={p.id}
                    nazev={p.name}
                    prvni={poradi === 0}
                    posledni={poradi === pole.length - 1}
                  />
                  <PoleDialog pole={p} />
                  <SmazaniObsahu
                    maly
                    titulek="Smazat pole"
                    nazev={p.name}
                    dusledky="Zmizí z karty všech klientů i z filtrů."
                    smazat={smazPole.bind(null, p.id)}
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
