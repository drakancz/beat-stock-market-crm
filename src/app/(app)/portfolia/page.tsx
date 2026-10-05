import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ResultValue } from "@/components/result-value";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireViewer } from "@/lib/session";
import { formatDatumCas, formatMoney } from "@/lib/format";
import { nactiPortfolia, nactiPozice } from "@/lib/queries";
import { portfolioResult, positionResult } from "@/lib/types";

export const metadata: Metadata = { title: "Portfolia" };

export const dynamic = "force-dynamic";

export default async function PortfoliaPage() {
  const viewer = await requireViewer();
  const [portfolia, pozice] = await Promise.all([nactiPortfolia(viewer), nactiPozice(viewer)]);

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Portfolia</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Portfolio nepatří klientovi, ale dvojici klient + broker. Jeden člověk může mít účet u
          dvou brokerů a u každého jiné pozice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Přehled portfolií</CardTitle>
          <CardDescription>Ceny se stahují jednou denně po zavření burzy.</CardDescription>
        </CardHeader>
        <CardContent>
          {portfolia.length === 0 ? (
            <EmptyState icon={BriefcaseBusiness} title="Zatím žádné portfolio." />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Klient</TableHead>
                    <TableHead>Broker</TableHead>
                    <TableHead className="hidden sm:table-cell">Zdroj dat</TableHead>
                    <TableHead className="text-right">Vloženo</TableHead>
                    <TableHead className="text-right">Hodnota</TableHead>
                    <TableHead className="text-right">Zisk / ztráta</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Načteno</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portfolia.map((portfolio) => {
                    const vysledek = portfolioResult(portfolio);

                    return (
                      <TableRow key={portfolio.id}>
                        <TableCell>
                          <Link
                            href={`/klienti/${portfolio.clientId}`}
                            className="font-medium whitespace-nowrap hover:underline"
                          >
                            {portfolio.clientName}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{portfolio.brokerName}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant={portfolio.source === "KLIC" ? "secondary" : "outline"}>
                            {portfolio.source === "KLIC" ? "klíč" : "ručně"}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {formatMoney(portfolio.invested, portfolio.currency)}
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {formatMoney(portfolio.value, portfolio.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <ResultValue
                            absolute={vysledek.absolute}
                            percent={vysledek.percent}
                            currency={portfolio.currency}
                          />
                        </TableCell>
                        <TableCell className="tabular text-muted-foreground hidden text-right text-xs whitespace-nowrap lg:table-cell">
                          {portfolio.lastSyncAt ? formatDatumCas(portfolio.lastSyncAt) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Všechny pozice</CardTitle>
          <CardDescription>Z obchodů se dopočítávají pozice — nezadává se dvakrát.</CardDescription>
        </CardHeader>
        <CardContent>
          {pozice.length === 0 ? (
            <EmptyState icon={BriefcaseBusiness} title="Zatím žádná pozice." />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="hidden sm:table-cell">Název</TableHead>
                    <TableHead className="hidden md:table-cell">Klient</TableHead>
                    <TableHead className="text-right">Kusů</TableHead>
                    <TableHead className="text-right">Nákup</TableHead>
                    <TableHead className="text-right">Aktuálně</TableHead>
                    <TableHead className="text-right">Výnos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pozice.map((polozka) => {
                    const vysledek = positionResult(polozka);

                    return (
                      <TableRow key={polozka.id}>
                        <TableCell className="tabular font-medium">{polozka.ticker}</TableCell>
                        <TableCell className="text-muted-foreground hidden sm:table-cell">
                          {polozka.name}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell">
                          {polozka.clientName}
                        </TableCell>
                        <TableCell className="tabular text-right">{polozka.quantity}</TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {formatMoney(polozka.averagePrice, polozka.currency)}
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {formatMoney(polozka.currentPrice, polozka.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <ResultValue
                            absolute={vysledek.absolute}
                            percent={vysledek.percent}
                            showPercentOnly
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
