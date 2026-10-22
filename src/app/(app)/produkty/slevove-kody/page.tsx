import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";

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
import { cenaPolozkyBezDph } from "@/lib/dph";
import { formatDatum, formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { jakoDen, posunDne } from "@/lib/obdobi";
import { requireViewer } from "@/lib/session";
import { popisSlevy } from "@/lib/slevove-kody";

import { SmazaniObsahu } from "../../vzdelavani/smazani-obsahu";
import { ZalozkyProduktu } from "../zalozky";

import { smazKod } from "./actions";
import { KodDialog } from "./kod-dialog";

export const metadata: Metadata = { title: "Slevové kódy" };

export const dynamic = "force-dynamic";

type Stav = { text: string; varianta: "outline" | "secondary" };

/** Jestli kód teď Landing Page přijme — jedním slovem do seznamu. */
function stavKodu(
  kod: { validFrom: Date | null; validTo: Date | null; maxUses: number | null },
  pouzito: number,
  ted: Date,
): Stav {
  if (kod.validFrom && ted < kod.validFrom) return { text: "Zatím neplatí", varianta: "secondary" };
  if (kod.validTo && ted >= posunDne(kod.validTo, 1))
    return { text: "Skončil", varianta: "secondary" };
  if (kod.maxUses !== null && pouzito >= kod.maxUses) {
    return { text: "Vyčerpaný", varianta: "secondary" };
  }
  return { text: "Platí", varianta: "outline" };
}

/**
 * Produkty → Slevové kódy (Fáze 5A, Jakub 14. 10. 2026).
 *
 * **Vidí každý přihlášený, zakládá a mění jen administrátor** — skrytí
 * tlačítek je úklid, roli ověřují akce (`requireAdmin()`).
 */
export default async function SlevoveKodyPage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  const [kody, produkty, doporucitele] = await Promise.all([
    db.discountCode.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        kind: true,
        value: true,
        note: true,
        validFrom: true,
        validTo: true,
        maxUses: true,
        oncePerClient: true,
        // Komu kód patří (5A, 15. 10. 2026) — jméno vidí každý, procenta jen
        // administrátor v Produkty → Doporučitelé.
        referrerId: true,
        referrer: { select: { name: true, deletedAt: true } },
        produkty: { select: { product: { select: { id: true, name: true } } } },
        objednavky: {
          where: { deletedAt: null },
          select: {
            status: true,
            currency: true,
            items: {
              select: {
                quantity: true,
                netPrice: true,
                vatPercent: true,
                listNetPrice: true,
                product: { select: { netPrice: true } },
              },
            },
          },
        },
      },
    }),
    jeAdmin
      ? db.product.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    jeAdmin
      ? db.referrer.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const ted = new Date();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Produkty</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Slevové kódy zadává zákazník na Landing Page. Slevu spočítá CRM samo a neplatný kód
            objednávku odmítne.
          </p>
        </div>
        {jeAdmin && <KodDialog produkty={produkty} doporucitele={doporucitele} />}
      </div>

      <ZalozkyProduktu jeAdmin={jeAdmin} />

      <Card>
        <CardHeader>
          <CardTitle>Slevové kódy</CardTitle>
          <CardDescription>
            Sleva v korunách je s DPH, tak jak ji vidí zákazník, a u víc produktů se rozpočítá podle
            jejich ceny. Do počtu použití se počítají všechny objednávky s kódem kromě smazaných.
            Sleva a tržby jsou bez DPH, stejně jako jinde v CRM; tržby jen ze zaplacených
            objednávek.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kody.length === 0 ? (
            <EmptyState
              icon={TicketPercent}
              title="Zatím žádný slevový kód."
              description={
                jeAdmin
                  ? "Založ první tlačítkem Nový kód nahoře."
                  : "Kódy zakládá administrátor. Až nějaký vznikne, uvidíš ho tady."
              }
            />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kód</TableHead>
                    <TableHead>Sleva</TableHead>
                    <TableHead className="hidden md:table-cell">Omezení</TableHead>
                    <TableHead className="text-right">Použito</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Sleva celkem</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Tržby</TableHead>
                    <TableHead>Stav</TableHead>
                    {jeAdmin && (
                      <TableHead className="w-20">
                        <span className="sr-only">Úpravy</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kody.map((kod) => {
                    const pouzito = kod.objednavky.length;
                    const zaplacene = kod.objednavky.filter((o) => o.status === "ZAPLACENO");
                    const mena = kod.objednavky[0]?.currency ?? "CZK";
                    const slevaCelkem = kod.objednavky.reduce(
                      (soucet, objednavka) =>
                        soucet +
                        objednavka.items.reduce(
                          (s, polozka) =>
                            s +
                            (polozka.listNetPrice
                              ? polozka.quantity *
                                (polozka.listNetPrice.toNumber() - cenaPolozkyBezDph(polozka))
                              : 0),
                          0,
                        ),
                      0,
                    );
                    const trzby = zaplacene.reduce(
                      (soucet, objednavka) =>
                        soucet +
                        objednavka.items.reduce(
                          (s, polozka) => s + polozka.quantity * cenaPolozkyBezDph(polozka),
                          0,
                        ),
                      0,
                    );
                    const omezeni = [
                      kod.validFrom || kod.validTo
                        ? `${kod.validFrom ? `od ${formatDatum(kod.validFrom)}` : ""}${kod.validFrom && kod.validTo ? " " : ""}${kod.validTo ? `do ${formatDatum(kod.validTo)}` : ""}`
                        : null,
                      kod.maxUses !== null ? `nejvýš ${kod.maxUses}×` : null,
                      kod.oncePerClient ? "jednou na klienta" : null,
                      kod.produkty.length > 0
                        ? `jen ${kod.produkty.map((vazba) => vazba.product.name).join(", ")}`
                        : null,
                    ].filter(Boolean);
                    const stav = stavKodu(kod, pouzito, ted);

                    return (
                      <TableRow key={kod.id}>
                        <TableCell className="max-w-56">
                          <span className="tabular block font-medium">{kod.code}</span>
                          {kod.referrer && (
                            <span className="text-muted-foreground block truncate text-xs">
                              Doporučitel: {kod.referrer.name}
                              {kod.referrer.deletedAt ? " (smazaný)" : ""}
                            </span>
                          )}
                          {kod.note && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {kod.note}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap">
                          {popisSlevy(kod.kind, kod.value.toNumber())}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden max-w-64 text-xs md:table-cell">
                          {omezeni.length > 0 ? omezeni.join(" · ") : "bez omezení"}
                        </TableCell>
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {pouzito}×
                          <span className="text-muted-foreground block text-xs">
                            {pocet(zaplacene.length, "zaplacená", "zaplacené", "zaplacených")}
                          </span>
                        </TableCell>
                        <TableCell className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                          {formatMoney(slevaCelkem, mena)}
                        </TableCell>
                        <TableCell className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                          {formatMoney(trzby, mena)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={stav.varianta}>{stav.text}</Badge>
                        </TableCell>
                        {jeAdmin && (
                          <TableCell>
                            <div className="flex justify-end">
                              <KodDialog
                                produkty={produkty}
                                doporucitele={doporucitele}
                                kod={{
                                  id: kod.id,
                                  code: kod.code,
                                  kind: kod.kind,
                                  value: kod.value.toNumber(),
                                  note: kod.note,
                                  validFrom: kod.validFrom ? jakoDen(kod.validFrom) : "",
                                  validTo: kod.validTo ? jakoDen(kod.validTo) : "",
                                  maxUses: kod.maxUses,
                                  oncePerClient: kod.oncePerClient,
                                  produkty: kod.produkty.map((vazba) => vazba.product.id),
                                  referrerId: kod.referrerId,
                                }}
                              />
                              <SmazaniObsahu
                                maly
                                titulek="Smazat slevový kód"
                                nazev={kod.code}
                                dusledky={
                                  pouzito > 0
                                    ? `Landing Page ho přestane přijímat. ${pocet(pouzito, "objednávka", "objednávky", "objednávek")} si slevu nechá.`
                                    : "Landing Page ho přestane přijímat."
                                }
                                smazat={smazKod.bind(null, kod.id)}
                              />
                            </div>
                          </TableCell>
                        )}
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
