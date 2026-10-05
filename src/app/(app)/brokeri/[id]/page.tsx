import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, ExternalLink } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoBrokera } from "@/components/logo-brokera";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { db } from "@/lib/db";
import { idZAdresy } from "@/lib/parametry";
import { viditelnaPortfolia } from "@/lib/queries";
import { formatDatumCas, formatMoney } from "@/lib/format";
import { requireViewer, type Viewer } from "@/lib/session";
import { AUTO_CONNECT_LABEL, PORTFOLIO_SOURCE_LABEL } from "@/lib/types";

import { AkceBrokera } from "./akce-brokera";

export const dynamic = "force-dynamic";

/**
 * Načte brokera i s portfolii, která **daná role smí vidět**.
 *
 * Od 22. 9. 2026 vidí každý přihlášený všechna portfolia — klienti se
 * nikomu nepřiřazují. Omezení (odložení klienti a portfolia) zůstává
 * v dotazu, ne ve výpisu (security_warnings.md, pravidlo 5). Vrací
 * `null`, když takový broker není.
 */
async function nactiBrokera(viewer: Viewer, id: string) {
  return db.broker.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      autoConnect: true,
      website: true,
      logo: true,
      note: true,
      deletedAt: true,
      portfolios: {
        where: viditelnaPortfolia(viewer),
        orderBy: { value: "desc" },
        select: {
          id: true,
          currency: true,
          invested: true,
          value: true,
          source: true,
          lastSyncAt: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: PageProps<"/brokeri/[id]">): Promise<Metadata> {
  await requireViewer();
  const id = idZAdresy((await params).id);
  const broker = id ? await db.broker.findUnique({ where: { id }, select: { name: true } }) : null;
  return { title: broker?.name ?? "Broker" };
}

/**
 * Detail brokera — vidí ho každý přihlášený, mění administrátor.
 *
 * Portfolia v záložce jsou omezená rolí: obchodník uvidí jen ta svých
 * klientů. Úpravy a koš dostane jen administrátor, a i to je jen úklid
 * rozhraní — serverové akce si oprávnění ověřují samy.
 */
export default async function BrokerPage({ params }: PageProps<"/brokeri/[id]">) {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const broker = await nactiBrokera(viewer, id);
  if (!broker) notFound();

  const vlozeno = broker.portfolios.reduce((soucet, p) => soucet + p.invested.toNumber(), 0);
  const hodnota = broker.portfolios.reduce((soucet, p) => soucet + p.value.toNumber(), 0);

  // Portfolia můžou být v různých měnách; sčítat je dohromady by lhalo.
  // Souhrn se proto ukáže jen tehdy, když je měna jedna jediná.
  const meny = new Set(broker.portfolios.map((p) => p.currency));
  const jednaMena = meny.size === 1 ? [...meny][0]! : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/brokeri">
          <ArrowLeft />
          Zpět na brokery
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <LogoBrokera nazev={broker.name} logo={broker.logo} className="size-12 text-sm" />
          <div>
            <h2 className="text-2xl font-semibold">{broker.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={broker.autoConnect === "ANO" ? "default" : "secondary"}>
                Napojení: {AUTO_CONNECT_LABEL[broker.autoConnect].toLowerCase()}
              </Badge>
              {broker.website && (
                <a
                  href={broker.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Web brokera
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>

        {jeAdmin && (
          <AkceBrokera
            vKosi={broker.deletedAt !== null}
            broker={{
              id: broker.id,
              name: broker.name,
              autoConnect: broker.autoConnect,
              website: broker.website,
              logo: broker.logo,
              note: broker.note,
              pocetPortfolii: broker.portfolios.length,
            }}
          />
        )}
      </div>

      {broker.deletedAt && (
        <Alert>
          <AlertDescription className="leading-relaxed">
            Tenhle broker je <strong>smazaný</strong> od {formatDatumCas(broker.deletedAt)}. Nikde
            se nenabízí a u nových portfolií si ho nikdo nevybere. Portfolia, která u něj klienti už
            mají, zůstávají beze změny.
          </AlertDescription>
        </Alert>
      )}

      {broker.note && (
        <Card>
          <CardHeader>
            <CardTitle>Poznámka</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm whitespace-pre-line">
            {broker.note}
          </CardContent>
        </Card>
      )}

      {/*
        Seznam obchodních případů tu býval do 22. 9. 2026. Zrušil se spolu
        s přestavbou na objednávky: u objednávky se broker nevede vůbec,
        takže není co vypisovat. Portfolia klientů u brokera zůstávají výš.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolia klientů ({broker.portfolios.length})</CardTitle>
          <CardDescription>
            {jednaMena
              ? `Vloženo celkem ${formatMoney(vlozeno, jednaMena)}, dnešní hodnota ${formatMoney(hodnota, jednaMena)}.`
              : "Portfolia jsou ve víc měnách, proto se nesčítají do jednoho součtu."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {broker.portfolios.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="U tohohle brokera zatím nikdo portfolio nemá."
              description="Až ho někdo bude mít, objeví se tady i s vloženou částkou."
            />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Klient</TableHead>
                    <TableHead className="hidden sm:table-cell">Zdroj dat</TableHead>
                    <TableHead className="text-right">Vloženo</TableHead>
                    <TableHead className="text-right">Hodnota</TableHead>
                    <TableHead className="text-right">Načteno</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {broker.portfolios.map((portfolio) => (
                    <TableRow key={portfolio.id}>
                      <TableCell>
                        <Link
                          href={`/klienti/${portfolio.client.id}`}
                          className="font-medium whitespace-nowrap hover:underline"
                        >
                          {portfolio.client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {PORTFOLIO_SOURCE_LABEL[portfolio.source]}
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {formatMoney(portfolio.invested.toNumber(), portfolio.currency)}
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {formatMoney(portfolio.value.toNumber(), portfolio.currency)}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground text-right whitespace-nowrap">
                        {portfolio.lastSyncAt ? (
                          formatDatumCas(portfolio.lastSyncAt)
                        ) : (
                          <span aria-hidden>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
