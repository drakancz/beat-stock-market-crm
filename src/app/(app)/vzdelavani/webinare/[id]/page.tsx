import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { idZAdresy } from "@/lib/parametry";
import { requireViewer } from "@/lib/session";
import { casProPole, POPIS_PUBLIKA } from "@/lib/vzdelavani/crm";

import { SmazaniObsahu } from "../../smazani-obsahu";
import { WebinarDialog } from "../../webinar-dialog";
import { smazWebinar, zrusUcast } from "../../webinare-actions";
import { ZapisUcasti } from "../../zapis-ucasti";

export const metadata: Metadata = { title: "Webinář" };

export const dynamic = "force-dynamic";

/**
 * Detail webináře s účastí (krok 3C). **Vidí každý přihlášený, mění
 * a účast zapisuje jen administrátor.**
 */
export default async function WebinarPage({ params }: PageProps<"/vzdelavani/webinare/[id]">) {
  const viewer = await requireViewer();
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const webinar = await db.webinar.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      durationMinutes: true,
      joinUrl: true,
      audience: true,
      courseId: true,
      remindersEnabled: true,
      remindedDayAt: true,
      remindedDayCount: true,
      remindedHourAt: true,
      remindedHourCount: true,
      course: { select: { title: true } },
      ucast: {
        orderBy: { createdAt: "asc" },
        select: {
          client: { select: { id: true, name: true } },
          markedBy: { select: { name: true } },
          createdAt: true,
        },
      },
    },
  });
  if (!webinar) notFound();

  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const [kurzy, klienti] = jeAdmin
    ? await Promise.all([
        db.course.findMany({
          where: { deletedAt: null },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        }),
        db.client.findMany({
          where: {
            deletedAt: null,
            mergedIntoId: null,
            NOT: { id: { in: webinar.ucast.map((u) => u.client.id) } },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/vzdelavani/webinare">
          <ArrowLeft />
          Zpět na webináře
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-xl font-semibold">{webinar.title}</h3>
          <p className="text-muted-foreground text-sm">
            {formatDatumCas(webinar.startsAt)} · {webinar.durationMinutes} min ·{" "}
            {POPIS_PUBLIKA[webinar.audience]}
            {webinar.course ? `: ${webinar.course.title}` : ""}
          </p>
          {webinar.joinUrl && (
            <a
              href={webinar.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              Odkaz na připojení
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {webinar.description && (
            <p className="max-w-2xl text-sm whitespace-pre-line">{webinar.description}</p>
          )}
          {/* Připomínka klientům (5C, 11. 10. 2026) — vidí každý přihlášený. */}
          <p className="text-muted-foreground text-xs">
            Připomínka:{" "}
            {!webinar.remindersEnabled
              ? "vypnutá"
              : [
                  webinar.remindedDayAt
                    ? `den předem ${formatDatumCas(webinar.remindedDayAt)}, doručeno ${pocet(webinar.remindedDayCount ?? 0, "klientovi", "klientům", "klientům")}`
                    : "den předem zatím ne",
                  webinar.remindedHourAt
                    ? `hodinu předem ${formatDatumCas(webinar.remindedHourAt)}, doručeno ${pocet(webinar.remindedHourCount ?? 0, "klientovi", "klientům", "klientům")}`
                    : "hodinu předem zatím ne",
                ].join(" · ")}
          </p>
        </div>
        {jeAdmin && (
          <div className="flex flex-wrap gap-2">
            <WebinarDialog
              kurzy={kurzy}
              webinar={{
                id: webinar.id,
                title: webinar.title,
                description: webinar.description ?? "",
                startsAt: casProPole(webinar.startsAt),
                durationMinutes: webinar.durationMinutes,
                joinUrl: webinar.joinUrl ?? "",
                audience: webinar.audience,
                courseId: webinar.courseId ?? "",
                remindersEnabled: webinar.remindersEnabled,
              }}
            />
            <SmazaniObsahu
              titulek="Smazat webinář"
              nazev={webinar.title}
              dusledky="Zmizí z klientské části. Zapsaná účast se přestane počítat do odznaků."
              smazat={smazWebinar.bind(null, webinar.id)}
              poSmazani="/vzdelavani/webinare"
            />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Účast</CardTitle>
          <CardDescription>
            {pocet(webinar.ucast.length, "klient", "klienti", "klientů")}. Za první a pátý webinář
            dostane klient odznak.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {jeAdmin && <ZapisUcasti webinarId={webinar.id} klienti={klienti} />}
          {webinar.ucast.length === 0 ? (
            <p className="text-muted-foreground text-sm">Zatím není zapsaná žádná účast.</p>
          ) : (
            <ul className="divide-border divide-y rounded-md border">
              {webinar.ucast.map((ucast) => (
                <li
                  key={ucast.client.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/klienti/${ucast.client.id}`}
                    className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
                  >
                    {ucast.client.name}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    Zapsáno: {ucast.markedBy?.name ?? "—"} · {formatDatumCas(ucast.createdAt)}
                  </span>
                  {jeAdmin && (
                    <SmazaniObsahu
                      maly
                      titulek="Zrušit účast"
                      nazev={`účast: ${ucast.client.name}`}
                      dusledky="Odznak, který klient už za webináře dostal, mu zůstane."
                      smazat={zrusUcast.bind(null, webinar.id, ucast.client.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
