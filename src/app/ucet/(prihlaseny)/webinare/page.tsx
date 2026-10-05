import type { Metadata } from "next";
import { CalendarClock, CheckCircle2, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { webinareKlienta } from "@/lib/vzdelavani/pristup";

export const metadata: Metadata = { title: "Webináře" };

export const dynamic = "force-dynamic";

/**
 * Webináře klienta (krok 3C): nadcházející, které jsou pro něj (všichni,
 * členové, kupci kurzu — `webinareKlienta()`), a proběhlé, kterých se
 * zúčastnil. Odkaz na připojení jen u nadcházejících.
 */
export default async function WebinareKlientaPage() {
  const klient = await requireKlient();
  const ted = new Date();

  const [mojeWebinare, ucasti] = await Promise.all([
    db.webinar.findMany({
      where: await webinareKlienta(klient.clientId),
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        durationMinutes: true,
        joinUrl: true,
      },
    }),
    db.webinarAttendance.findMany({
      where: { clientId: klient.clientId, webinar: { deletedAt: null } },
      orderBy: { webinar: { startsAt: "desc" } },
      select: { webinar: { select: { id: true, title: true, startsAt: true } } },
    }),
  ]);

  const nadchazejici = mojeWebinare.filter(
    (w) => w.startsAt.getTime() + w.durationMinutes * 60_000 >= ted.getTime(),
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Webináře</h1>

      {nadchazejici.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-center gap-3 text-sm">
            <CalendarClock className="size-5 shrink-0" aria-hidden />
            Teď pro vás nemáme naplánovaný žádný webinář.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {nadchazejici.map((w) => (
            <li key={w.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{w.title}</CardTitle>
                  <p className="text-muted-foreground text-sm">
                    {formatDatumCas(w.startsAt)} · {w.durationMinutes} min
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {w.description && <p className="text-sm whitespace-pre-line">{w.description}</p>}
                  {w.joinUrl ? (
                    <a
                      href={w.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    >
                      Připojit se
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    <p className="text-muted-foreground text-xs">Odkaz na připojení doplníme.</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {ucasti.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Webináře, kterých jste se zúčastnili</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {ucasti.map(({ webinar }) => (
                <li key={webinar.id} className="flex items-center gap-2 py-2 text-sm">
                  <CheckCircle2 className="text-primary size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{webinar.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatDatumCas(webinar.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
