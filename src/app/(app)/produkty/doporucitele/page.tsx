import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
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
import { db } from "@/lib/db";
import { formatDatum, formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";
import { ZalozkyProduktu } from "../zalozky";

import { smazDoporucitele } from "./actions";
import { DoporucitelDialog } from "./doporucitel-dialog";
import { Vyplaceni } from "./vyplaceni";

export const metadata: Metadata = { title: "Doporučitelé" };

export const dynamic = "force-dynamic";

const procenta = (hodnota: number) =>
  `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(hodnota)} %`;

/**
 * Produkty → Doporučitelé (Fáze 5A, 2. část, Jakub 15. 10. 2026).
 *
 * **Jen administrátor** — `requireAdmin()` vrací ostatním 404. Kdo klienta
 * přivedl, vidí každý na kartě klienta; doporučitele, procenta a odměny
 * jen tady. Pravidla jsou v `src/lib/doporuceni.ts`.
 */
export default async function DoporucitelePage() {
  await requireAdmin();

  const [doporucitele, odmeny, klienti] = await Promise.all([
    db.referrer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        kind: true,
        name: true,
        rewardPercent: true,
        note: true,
        client: { select: { id: true, name: true, deletedAt: true } },
        kody: { where: { deletedAt: null }, select: { code: true }, orderBy: { code: "asc" } },
        _count: { select: { privedeni: { where: { deletedAt: null } } } },
        odmeny: { select: { amount: true, currency: true, paidOutAt: true } },
      },
    }),
    db.referralReward.findMany({
      // Nevyplacené nahoře, pak od nejnovější.
      orderBy: [{ paidOutAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        percent: true,
        base: true,
        amount: true,
        currency: true,
        paidOutAt: true,
        createdAt: true,
        paidOutBy: { select: { name: true } },
        referrer: { select: { name: true, deletedAt: true } },
        order: {
          select: {
            number: true,
            deletedAt: true,
            client: { select: { id: true, name: true, deletedAt: true } },
          },
        },
      },
    }),
    // Do výběru v okně Nový doporučitel jen klienti, kteří doporučiteli ještě nejsou.
    db.client.findMany({
      where: { deletedAt: null, doporucitel: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const mena = odmeny[0]?.currency ?? "CZK";
  const kVyplate = odmeny
    .filter((odmena) => !odmena.paidOutAt)
    .reduce((soucet, odmena) => soucet + odmena.amount.toNumber(), 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Produkty</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Doporučitel má vlastní slevový kód. Nový klient, který s ním poprvé objedná, je jeho
            přivedený a z první zaplacené objednávky mu vznikne odměna.
          </p>
        </div>
        <DoporucitelDialog klienti={klienti} />
      </div>

      <ZalozkyProduktu jeAdmin />

      <Card>
        <CardHeader>
          <CardTitle>Doporučitelé</CardTitle>
          <CardDescription>
            Odměna je procento z ceny první zaplacené objednávky po slevě, bez DPH. Kód doporučiteli
            přiřadíš v okně slevového kódu (Produkty → Slevové kódy). Doporučitele, procenta a
            odměny vidí jen administrátor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doporucitele.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Zatím žádný doporučitel."
              description="Založ prvního tlačítkem Nový doporučitel nahoře."
            />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doporučitel</TableHead>
                    <TableHead>Kód</TableHead>
                    <TableHead className="text-right">Odměna</TableHead>
                    <TableHead className="text-right">Přivedl</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">K výplatě</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Vyplaceno</TableHead>
                    <TableHead className="w-20">
                      <span className="sr-only">Úpravy</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doporucitele.map((doporucitel) => {
                    const jmeno =
                      doporucitel.client && !doporucitel.client.deletedAt
                        ? doporucitel.client.name
                        : doporucitel.name;
                    const soucet = (vyplacene: boolean) =>
                      doporucitel.odmeny
                        .filter((odmena) => (odmena.paidOutAt !== null) === vyplacene)
                        .reduce((s, odmena) => s + odmena.amount.toNumber(), 0);
                    const menaDoporucitele = doporucitel.odmeny[0]?.currency ?? "CZK";

                    return (
                      <TableRow key={doporucitel.id}>
                        <TableCell className="max-w-56">
                          {doporucitel.client && !doporucitel.client.deletedAt ? (
                            <Link
                              href={`/klienti/${doporucitel.client.id}`}
                              className="block truncate font-medium underline-offset-4 hover:underline"
                            >
                              {jmeno}
                            </Link>
                          ) : (
                            <span className="block truncate font-medium">{jmeno}</span>
                          )}
                          <span className="text-muted-foreground block truncate text-xs">
                            {doporucitel.kind === "KLIENT" ? "klient" : "partner"}
                            {doporucitel.note ? ` · ${doporucitel.note}` : ""}
                          </span>
                        </TableCell>
                        <TableCell className="tabular text-sm">
                          {doporucitel.kody.length > 0 ? (
                            doporucitel.kody.map((kod) => kod.code).join(", ")
                          ) : (
                            <Badge variant="secondary">bez kódu</Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {procenta(doporucitel.rewardPercent.toNumber())}
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {pocet(doporucitel._count.privedeni, "klient", "klienti", "klientů")}
                        </TableCell>
                        <TableCell className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                          {formatMoney(soucet(false), menaDoporucitele)}
                        </TableCell>
                        <TableCell className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                          {formatMoney(soucet(true), menaDoporucitele)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <DoporucitelDialog
                              klienti={[]}
                              doporucitel={{
                                id: doporucitel.id,
                                kind: doporucitel.kind,
                                name: jmeno,
                                rewardPercent: doporucitel.rewardPercent.toNumber(),
                                note: doporucitel.note,
                              }}
                            />
                            <SmazaniObsahu
                              maly
                              titulek="Smazat doporučitele"
                              nazev={jmeno}
                              dusledky="Přivedení klienti a odměny zůstanou. Doporučitel s platným slevovým kódem smazat nejde — kód nejdřív smaž nebo přiřaď jinam."
                              smazat={smazDoporucitele.bind(null, doporucitel.id)}
                            />
                          </div>
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
          <CardTitle>Odměny</CardTitle>
          <CardDescription>
            {odmeny.length === 0
              ? "Odměna vznikne, až přivedený klient zaplatí svou první objednávku."
              : `K výplatě celkem ${formatMoney(kVyplate, mena)}. Po vyplacení odměnu odškrtni. Když se objednávka vrátí ze Zaplaceno nebo smaže, nevyplacená odměna zmizí; vyplacená zůstane.`}
          </CardDescription>
        </CardHeader>
        {odmeny.length > 0 && (
          <CardContent>
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doporučitel</TableHead>
                    <TableHead>Přivedený klient</TableHead>
                    <TableHead className="hidden md:table-cell">Objednávka</TableHead>
                    <TableHead className="text-right">Odměna</TableHead>
                    <TableHead>Stav</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {odmeny.map((odmena) => {
                    const klient = odmena.order.client;
                    return (
                      <TableRow key={odmena.id}>
                        <TableCell className="max-w-48 truncate font-medium">
                          {odmena.referrer.name}
                        </TableCell>
                        <TableCell className="max-w-48">
                          {klient.deletedAt ? (
                            <span className="block truncate">{klient.name}</span>
                          ) : (
                            <Link
                              href={`/klienti/${klient.id}`}
                              className="block truncate underline-offset-4 hover:underline"
                            >
                              {klient.name}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-muted-foreground hidden text-sm md:table-cell">
                          {odmena.order.number}
                          {odmena.order.deletedAt ? " (smazaná)" : ""}
                          <span className="block text-xs">{formatDatum(odmena.createdAt)}</span>
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {formatMoney(odmena.amount.toNumber(), odmena.currency)}
                          <span className="text-muted-foreground block text-xs">
                            {procenta(odmena.percent.toNumber())} z{" "}
                            {formatMoney(odmena.base.toNumber(), odmena.currency)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            {odmena.paidOutAt ? (
                              <span className="text-muted-foreground text-xs">
                                Vyplaceno {formatDatum(odmena.paidOutAt)}
                                {odmena.paidOutBy ? ` (${odmena.paidOutBy.name})` : ""}
                              </span>
                            ) : (
                              <Badge variant="outline">K výplatě</Badge>
                            )}
                            <Vyplaceni
                              odmenaId={odmena.id}
                              vyplaceno={odmena.paidOutAt !== null}
                              popis={`${odmena.referrer.name}, objednávka ${odmena.order.number}`}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </>
  );
}
