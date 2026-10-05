import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { requireViewer } from "@/lib/session";
import { POPIS_PUBLIKA } from "@/lib/vzdelavani/crm";

import { WebinarDialog } from "../webinar-dialog";

export const metadata: Metadata = { title: "Vzdělávání — webináře" };

export const dynamic = "force-dynamic";

/**
 * Webináře (krok 3C). **Vidí každý přihlášený, plánuje a účast zapisuje
 * jen administrátor.**
 */
export default async function WebinarePage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const ted = new Date();

  const [webinare, kurzy] = await Promise.all([
    db.webinar.findMany({
      where: { deletedAt: null },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        durationMinutes: true,
        audience: true,
        course: { select: { title: true } },
        _count: { select: { ucast: true } },
      },
    }),
    jeAdmin
      ? db.course.findMany({
          where: { deletedAt: null },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  const konec = (w: (typeof webinare)[number]) =>
    new Date(w.startsAt.getTime() + w.durationMinutes * 60_000);
  const nadchazejici = webinare.filter((w) => konec(w) >= ted).reverse();
  const probehle = webinare.filter((w) => konec(w) < ted);

  const radek = (w: (typeof webinare)[number], probehl: boolean) => (
    <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 flex-1">
        <Link
          href={`/vzdelavani/webinare/${w.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {w.title}
        </Link>
        <p className="text-muted-foreground text-xs">
          {formatDatumCas(w.startsAt)} · {POPIS_PUBLIKA[w.audience]}
          {w.course ? `: ${w.course.title}` : ""}
          {probehl ? ` · účast ${pocet(w._count.ucast, "klient", "klienti", "klientů")}` : ""}
        </p>
      </div>
    </li>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Webináře</CardTitle>
          <CardDescription>
            Termíny pro klienty. U proběhlého webináře zapiš, kdo se zúčastnil — klient za to
            dostane odznak.
          </CardDescription>
        </div>
        {jeAdmin && <WebinarDialog kurzy={kurzy} />}
      </CardHeader>
      <CardContent className="space-y-6">
        {webinare.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Zatím není naplánovaný žádný webinář."
            description={jeAdmin ? "Naplánuj první tlačítkem Nový webinář." : undefined}
          />
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Nadcházející</h3>
              {nadchazejici.length === 0 ? (
                <p className="text-muted-foreground text-sm">Žádný nadcházející webinář.</p>
              ) : (
                <ul className="divide-border divide-y rounded-md border">
                  {nadchazejici.map((w) => radek(w, false))}
                </ul>
              )}
            </section>
            {probehle.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Proběhlé</h3>
                <ul className="divide-border divide-y rounded-md border">
                  {probehle.map((w) => radek(w, true))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
