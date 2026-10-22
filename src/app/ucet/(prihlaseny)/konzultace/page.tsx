import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CheckCircle2, ExternalLink } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import {
  ZRUSIT_PREDEM_HODIN,
  lzeZrusitKlientem,
  stavKonzultaci,
  volneTerminy,
} from "@/lib/konzultace";
import { requireKlient } from "@/lib/klient/sezeni";

import { PrelozeniRezervace, Rezervovat, ZruseniRezervace } from "./tlacitka";

export const metadata: Metadata = { title: "Konzultace" };

export const dynamic = "force-dynamic";

/** Kolik volných termínů se klientovi ukáže. */
const NEJVIC_TERMINU = 40;

/**
 * Konzultace klienta (Fáze 5B, Jakub 19. 10. 2026). Kolik jich má
 * zaplacených a kolik zbývá, jeho rezervace a volné termíny. **Jen vlastní
 * rezervace** (`clientId` z přihlášení); u volného termínu se neukazuje,
 * kdo vede ani odkaz na připojení — odkaz klient uvidí až u své rezervace.
 */
export default async function KonzultaceKlientaPage() {
  const klient = await requireKlient();
  const ted = new Date();

  const [stav, rezervace, volne, produkt] = await Promise.all([
    stavKonzultaci(klient.clientId),
    db.consultationBooking.findMany({
      where: { clientId: klient.clientId, cancelledAt: null, slot: { deletedAt: null } },
      orderBy: { slot: { startsAt: "asc" } },
      select: {
        id: true,
        slot: {
          select: { startsAt: true, durationMinutes: true, place: true, joinUrl: true },
        },
      },
    }),
    db.consultationSlot.findMany({
      where: volneTerminy(ted),
      orderBy: { startsAt: "asc" },
      take: NEJVIC_TERMINU,
      select: { id: true, startsAt: true, durationMinutes: true, place: true },
    }),
    db.product.findFirst({
      // Koupit v klientské části (20. 10. 2026) — první prodávaná konzultace.
      where: { kind: "KONZULTACE", active: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true },
    }),
  ]);

  const konec = (r: (typeof rezervace)[number]) =>
    r.slot.startsAt.getTime() + r.slot.durationMinutes * 60_000;
  const nadchazejici = rezervace.filter((r) => konec(r) >= ted.getTime());
  const probehle = rezervace.filter((r) => konec(r) < ted.getTime()).reverse();
  const terminy = volne.map((t) => ({
    id: t.id,
    popis: `${formatDatumCas(t.startsAt)} · ${t.durationMinutes} min${t.place ? ` · ${t.place}` : ""}`,
  }));

  return (
    <>
      <h1 className="text-2xl font-semibold">Konzultace</h1>

      <Card>
        <CardHeader>
          <CardTitle>Vaše konzultace</CardTitle>
          {stav.zaplaceno > 0 ? (
            <CardDescription data-testid="stav-konzultaci">
              Zaplaceno {stav.zaplaceno} · využito {stav.vyuzito} ·{" "}
              <strong className="text-foreground">zbývá {stav.zbyva}</strong>
            </CardDescription>
          ) : (
            <CardDescription>
              Zatím nemáte zaplacenou žádnou konzultaci. Po zaplacení si tady vyberete termín.
            </CardDescription>
          )}
        </CardHeader>
        {stav.zbyva === 0 && produkt && (
          <CardContent>
            <Link
              href={`/ucet/koupit?produkt=${produkt.id}`}
              className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              Objednat konzultaci
            </Link>
          </CardContent>
        )}
      </Card>

      {nadchazejici.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vaše rezervace</CardTitle>
            <CardDescription>
              Zrušit nebo přeložit ji můžete nejpozději {ZRUSIT_PREDEM_HODIN} hodin předem.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {nadchazejici.map((r) => {
                const kdy = formatDatumCas(r.slot.startsAt);
                const lzeMenit = lzeZrusitKlientem(r.slot.startsAt, ted);
                return (
                  <li
                    key={r.id}
                    data-testid="moje-rezervace"
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                  >
                    <div className="min-w-48 flex-1">
                      <p className="font-medium tabular-nums">{kdy}</p>
                      <p className="text-muted-foreground text-xs">
                        {r.slot.durationMinutes} min{r.slot.place ? ` · ${r.slot.place}` : ""}
                      </p>
                      {r.slot.joinUrl && (
                        <a
                          href={r.slot.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                        >
                          Připojit se
                          <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      )}
                    </div>
                    {lzeMenit ? (
                      <div className="flex flex-wrap gap-2">
                        <PrelozeniRezervace bookingId={r.id} kdy={kdy} terminy={terminy} />
                        <ZruseniRezervace bookingId={r.id} kdy={kdy} />
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Změnu teď už domluvíte jen s námi.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {stav.zbyva > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Volné termíny</CardTitle>
          </CardHeader>
          <CardContent>
            {terminy.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-3 text-sm">
                <CalendarCheck className="size-5 shrink-0" aria-hidden />
                Teď nemáme vypsaný žádný volný termín. Brzy přidáme další.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {terminy.map((t) => (
                  <li
                    key={t.id}
                    data-testid="volny-termin"
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm tabular-nums">{t.popis}</span>
                    <Rezervovat slotId={t.id} popis={t.popis} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {probehle.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Proběhlé konzultace</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {probehle.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                  <CheckCircle2 className="text-primary size-4 shrink-0" aria-hidden />
                  <span className="tabular-nums">{formatDatumCas(r.slot.startsAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
