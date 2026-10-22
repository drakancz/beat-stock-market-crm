import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db";
import { fakturyZapnute, obdobiFaktur, prectiDoklad } from "@/lib/faktury/faktury";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDatum, formatMoney } from "@/lib/format";
import { viditelneObjednavky } from "@/lib/queries";
import { requireViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Faktury" };

export const dynamic = "force-dynamic";

const den = (datum: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(datum);

/**
 * Faktury a dobropisy za období (19. 10. 2026). **Vidí každý přihlášený**
 * (Jakub: tým faktury vidí), stáhne PDF, ISDOC a export pro účetnictví
 * (CSV, Pohoda). Dobropis vystavuje jen administrátor u objednávky.
 */
export default async function FakturyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const obdobi = obdobiFaktur(await searchParams);
  const zapnute = await fakturyZapnute();

  const doklady = await db.invoice.findMany({
    where: {
      issuedAt: { gte: obdobi.od, lt: obdobi.doVcetne },
      order: viditelneObjednavky(viewer),
    },
    orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
    select: {
      id: true,
      number: true,
      kind: true,
      issuedAt: true,
      total: true,
      currency: true,
      simplified: true,
      customer: true,
      supplier: true,
      items: true,
      order: { select: { number: true } },
    },
  });

  const dotaz = `od=${den(obdobi.od)}&do=${den(obdobi.do)}`;
  const celkem = doklady.reduce((s, d) => s + d.total.toNumber(), 0);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/objednavky">
          <ArrowLeft />
          Objednávky
        </Link>
      </Button>
      <Card>
        <CardHeader className="space-y-3">
          <div className="space-y-1.5">
            <CardTitle>Faktury</CardTitle>
            <CardDescription>
              Faktury vznikají samy po zaplacení objednávky. Doklad nejde změnit ani smazat — oprava
              je dobropis (u objednávky, jen administrátor).
            </CardDescription>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="faktury-od">Od</Label>
              <Input id="faktury-od" name="od" type="date" defaultValue={den(obdobi.od)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="faktury-do">Do</Label>
              <Input id="faktury-do" name="do" type="date" defaultValue={den(obdobi.do)} />
            </div>
            <Button type="submit" variant="outline">
              Zobrazit
            </Button>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button asChild variant="outline">
                <a href={`/objednavky/faktury/export?format=csv&${dotaz}`}>
                  <Download />
                  CSV
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`/objednavky/faktury/export?format=pohoda&${dotaz}`}>
                  <Download />
                  Pohoda XML
                </a>
              </Button>
            </div>
          </form>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Pojistka (19. 10. 2026): bez údajů firmy faktury nevznikají. */}
          {!zapnute.ok && (
            <Alert variant="destructive">
              <AlertDescription>
                Faktury jsou vypnuté — v Nastavení → Firma chybí: {zapnute.chybi.join(", ")}.
                Zaplacené objednávky fakturu nedostanou; po doplnění ji administrátor vystaví u
                objednávky tlačítkem Vystavit fakturu.
              </AlertDescription>
            </Alert>
          )}
          {doklady.length === 0 ? (
            <EmptyState icon={FileText} title="V tomhle období žádná faktura není." />
          ) : (
            <>
              <ul className="divide-border divide-y rounded-md border" aria-label="Faktury">
                {doklady.map((d) => {
                  const { odberatel } = prectiDoklad(d);
                  return (
                    <li
                      key={d.id}
                      data-testid="faktura"
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      <div className="min-w-48 flex-1">
                        <p className="font-medium tabular-nums">
                          {d.number}
                          <span className="text-muted-foreground font-normal">
                            {d.kind === "DOBROPIS"
                              ? " · dobropis"
                              : d.simplified
                                ? " · zjednodušený doklad"
                                : ""}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDatum(d.issuedAt)} · objednávka {d.order.number}
                          {odberatel ? ` · ${odberatel.nazev}` : ""}
                        </p>
                      </div>
                      <span className="font-medium tabular-nums">
                        {formatMoney(d.total.toNumber(), d.currency)}
                      </span>
                      <span className="flex gap-3 text-xs">
                        <a
                          href={`/objednavky/faktura/${d.id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          PDF
                        </a>
                        <a
                          href={`/objednavky/faktura/${d.id}/isdoc`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          ISDOC
                        </a>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground mt-3 text-right text-sm">
                Celkem za období s DPH:{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {formatMoney(celkem, "CZK")}
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
