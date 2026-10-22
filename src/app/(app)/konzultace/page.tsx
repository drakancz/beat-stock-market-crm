import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { klientiSVolnouKonzultaci } from "@/lib/konzultace";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import { requireViewer } from "@/lib/session";

import { smazTermin, zrusRezervaci } from "./actions";
import { Potvrzeni } from "./potvrzeni";
import { RezervaceZaKlienta } from "./rezervace-za-klienta";
import { TerminDialog } from "./termin-dialog";

export const metadata: Metadata = { title: "Konzultace" };

export const dynamic = "force-dynamic";

/** Proběhlé konzultace se ukazují za posledních tolik dní. */
const PROBEHLE_DNU = 60;

/**
 * Konzultace (Fáze 5B, Jakub 19. 10. 2026). **Vidí každý přihlášený,
 * termíny vypisuje a maže a rezervace ruší jen administrátor** — tlačítka
 * se ostatním nekreslí a akce volají `requireAdmin()`.
 */
export default async function KonzultacePage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const ted = new Date();

  const vyber = {
    id: true,
    startsAt: true,
    durationMinutes: true,
    place: true,
    host: { select: { name: true } },
    activeBooking: { select: { id: true, client: { select: { id: true, name: true } } } },
  } as const;

  const [nadchazejici, probehle, tym, sKonzultaci] = await Promise.all([
    db.consultationSlot.findMany({
      where: { deletedAt: null, startsAt: { gt: ted } },
      orderBy: { startsAt: "asc" },
      select: vyber,
    }),
    db.consultationSlot.findMany({
      where: {
        deletedAt: null,
        activeBookingId: { not: null },
        startsAt: { lte: ted, gte: posunDne(dnesniZacatek(), -PROBEHLE_DNU) },
      },
      orderBy: { startsAt: "desc" },
      select: vyber,
    }),
    jeAdmin
      ? db.user.findMany({
          where: { active: true, deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Rezervace za klienta (19. 10. 2026) — smí každý přihlášený.
    klientiSVolnouKonzultaci(),
  ]);

  const volnych = nadchazejici.filter((t) => !t.activeBooking).length;

  const radek = (t: (typeof nadchazejici)[number], probehl: boolean) => {
    const kdy = formatDatumCas(t.startsAt);
    const klient = t.activeBooking?.client;
    return (
      <li
        key={t.id}
        data-testid="termin-konzultace"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
      >
        <div className="min-w-48 flex-1">
          <p className="font-medium tabular-nums">{kdy}</p>
          <p className="text-muted-foreground text-xs">
            {t.durationMinutes} min
            {t.place ? ` · ${t.place}` : ""}
            {t.host ? ` · vede ${t.host.name}` : ""}
          </p>
        </div>
        {klient ? (
          <Link
            href={`/klienti/${klient.id}`}
            className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {klient.name}
          </Link>
        ) : (
          <Badge variant="outline">Volný</Badge>
        )}
        {jeAdmin && !probehl && t.activeBooking && (
          <Potvrzeni
            tlacitko="Zrušit rezervaci"
            titulek="Zrušit rezervaci"
            popis={
              <>
                Zrušit rezervaci {klient?.name} na {kdy}? Klient dostane upozornění, konzultace se
                mu vrátí a termín bude zase volný. <strong>Tuhle akci nelze vzít zpět.</strong>
              </>
            }
            potvrdit="Zrušit rezervaci"
            zpet="Ponechat rezervaci"
            akce={zrusRezervaci.bind(null, t.activeBooking.id)}
          />
        )}
        {!probehl && !t.activeBooking && sKonzultaci.length > 0 && (
          <RezervaceZaKlienta slotId={t.id} kdy={kdy} klienti={sKonzultaci} />
        )}
        {jeAdmin && !probehl && !t.activeBooking && (
          <Potvrzeni
            tlacitko="Smazat"
            titulek="Smazat termín"
            popis={
              <>
                Opravdu smazat termín {kdy}? Klienti ho přestanou vidět. Termín, který si mezitím
                někdo zarezervuje, smazat nejde. <strong>Tuhle akci nelze vzít zpět.</strong>
              </>
            }
            potvrdit="Smazat"
            akce={smazTermin.bind(null, t.id)}
          />
        )}
      </li>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Konzultace</CardTitle>
          <CardDescription>
            Volné termíny si zarezervují klienti se zaplacenou konzultací v klientské části. Zrušit
            nebo přeložit ji smí sami nejpozději 24 hodin předem.
          </CardDescription>
        </div>
        {jeAdmin && <TerminDialog tym={tym} vychoziVede={viewer.id} />}
      </CardHeader>
      <CardContent className="space-y-6">
        {nadchazejici.length === 0 && probehle.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Zatím není vypsaný žádný termín."
            description={jeAdmin ? "Vypiš první tlačítkem Vypsat termíny." : undefined}
          />
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Nadcházející
                {nadchazejici.length > 0 && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · volných {volnych} z {nadchazejici.length}
                  </span>
                )}
              </h3>
              {nadchazejici.length === 0 ? (
                <p className="text-muted-foreground text-sm">Žádný nadcházející termín.</p>
              ) : (
                <ul className="divide-border divide-y rounded-md border">
                  {nadchazejici.map((t) => radek(t, false))}
                </ul>
              )}
            </section>
            {probehle.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Proběhlé za posledních {PROBEHLE_DNU} dní</h3>
                <ul className="divide-border divide-y rounded-md border">
                  {probehle.map((t) => radek(t, true))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
