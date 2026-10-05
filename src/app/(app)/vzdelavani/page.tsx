import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireViewer } from "@/lib/session";
import { kurzyBezObsahu } from "@/lib/vzdelavani/crm";

import { KurzDialog } from "./kurz-dialog";

export const metadata: Metadata = { title: "Vzdělávání — kurzy" };

export const dynamic = "force-dynamic";

/**
 * Kurzy (krok 3C). **Vidí každý přihlášený, zakládá jen administrátor.**
 */
export default async function KurzyPage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  const [kurzy, volneProdukty] = await Promise.all([
    db.course.findMany({
      where: { deletedAt: null },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        publishedAt: true,
        product: { select: { name: true } },
        _count: { select: { lekce: { where: { deletedAt: null } } } },
      },
    }),
    jeAdmin ? kurzyBezObsahu() : Promise.resolve([]),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Kurzy</CardTitle>
          <CardDescription>
            Každý kurz patří ke kurzu v ceníku. Obsah uvidí klient, který má kurz zaplacený —
            napořád. Koncept klienti nevidí.
          </CardDescription>
        </div>
        {jeAdmin && <KurzDialog produkty={volneProdukty} />}
      </CardHeader>
      <CardContent>
        {kurzy.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Zatím tu není žádný kurz."
            description={
              jeAdmin
                ? "Založ první tlačítkem Nový kurz a přidej do něj lekce."
                : "Až administrátor kurz založí, objeví se tady."
            }
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {kurzy.map((kurz) => (
              <li key={kurz.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/vzdelavani/kurzy/${kurz.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {kurz.title}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {kurz.product.name} · {pocet(kurz._count.lekce, "lekce", "lekce", "lekcí")}
                  </p>
                </div>
                <Badge variant={kurz.publishedAt ? "default" : "secondary"}>
                  {kurz.publishedAt ? "Zveřejněno" : "Koncept"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
