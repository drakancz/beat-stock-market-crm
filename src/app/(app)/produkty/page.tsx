import type { Metadata } from "next";
import { ExternalLink, Package } from "lucide-react";

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
import { popisSazby } from "@/lib/dph";
import { formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { nactiProdukty, nactiSazbyDph } from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { PRODUCT_KIND_LABEL } from "@/lib/types";

import { ProduktDialog } from "./produkt-dialog";

export const metadata: Metadata = { title: "Produkty" };

export const dynamic = "force-dynamic";

export default async function ProduktyPage() {
  // Katalog je stejný pro všechny role, přihlášení se ale vyžaduje i tady —
  // ať platí bez výjimky, že první řádek chráněné obrazovky je kontrola.
  const viewer = await requireViewer();
  const [produkty, sazby] = await Promise.all([nactiProdukty(), nactiSazbyDph()]);

  // Ceník mění jen administrátor (od 22. 9. 2026). Skrytí tlačítek je
  // úklid rozhraní, ne ochrana — roli si ověřují serverové akce.
  const muzeZakladat = viewer.role === "ADMINISTRATOR";
  const sazbyKVyberu = sazby.map((sazba) => ({ id: sazba.id, name: sazba.name, rate: sazba.rate }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Produkty</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Katalog kurzů, členství a konzultací. U hovoru se zapisuje zájem o konkrétní produkt, ne
            obecná poznámka.
          </p>
        </div>
        {muzeZakladat && <ProduktDialog sazby={sazbyKVyberu} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Katalog</CardTitle>
          <CardDescription>
            Ceny se ukládají bez DPH — s nimi se počítají hodnoty objednávek. Zadat je jde s DPH i
            bez. Cena s DPH se dopočítává ze sazby produktu; sazby mění administrátor v Nastavení.
            Platnost běží od zaplacení a další zaplacení na ni navazuje. Prodáno je počet kusů v
            zaplacených objednávkách. Název produktu vede na jeho stránku, když ji má.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {produkty.length === 0 ? (
            <EmptyState
              icon={Package}
              title="V ceníku zatím nic není."
              description={
                muzeZakladat
                  ? "Přidej první produkt tlačítkem nahoře — název vybereš z nabídky, nebo si napíšeš vlastní."
                  : "Až někdo produkt přidá, objeví se tady i s cenou a stavem."
              }
            />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Název</TableHead>
                    <TableHead>Druh</TableHead>
                    <TableHead className="text-right">Cena bez DPH</TableHead>
                    <TableHead className="text-right">Platnost</TableHead>
                    <TableHead className="text-right">Prodáno</TableHead>
                    <TableHead className="text-right">Stav</TableHead>
                    {muzeZakladat && (
                      <TableHead className="w-10">
                        <span className="sr-only">Upravit</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produkty.map((produkt) => (
                    <TableRow key={produkt.id}>
                      <TableCell className="font-medium">
                        {/*
                          Název vede na stránku produktu (Jakub, 24. 9. 2026),
                          když ji administrátor zadal. Stránka je mimo CRM,
                          proto nová záložka a `noopener noreferrer` — cizí
                          stránka se nedostane k oknu CRM ani nepozná adresu,
                          ze které přišla.
                        */}
                        {produkt.url ? (
                          <a
                            href={produkt.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                          >
                            {produkt.name}
                            <ExternalLink className="text-muted-foreground size-3.5" aria-hidden />
                          </a>
                        ) : (
                          produkt.name
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{PRODUCT_KIND_LABEL[produkt.kind]}</Badge>
                      </TableCell>
                      {/*
                        Hlavní číslo je cena bez daně — s tou se počítají
                        hodnoty zakázek. Cena, kterou platí klient, je pod ní.
                      */}
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {formatMoney(produkt.cenaBezDph, produkt.currency)}
                        <span className="text-muted-foreground block text-xs">
                          {formatMoney(produkt.cenaSDph, produkt.currency)} s DPH{" "}
                          {popisSazby(produkt.sazba)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {produkt.validityMonths ? (
                          pocet(produkt.validityMonths, "měsíc", "měsíce", "měsíců")
                        ) : produkt.kind === "KONZULTACE" ? (
                          // Jednorázová služba (Jakub, 28. 9. 2026), ne „napořád".
                          <span className="text-muted-foreground">jednorázově</span>
                        ) : (
                          <span className="text-muted-foreground">neomezeno</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {produkt.prodano > 0 ? (
                          `${produkt.prodano} ks`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={produkt.active ? "outline" : "secondary"}>
                          {produkt.active ? "V prodeji" : "Neaktivní"}
                        </Badge>
                      </TableCell>
                      {muzeZakladat && (
                        <TableCell className="text-right">
                          <ProduktDialog
                            sazby={sazbyKVyberu}
                            produkt={{
                              id: produkt.id,
                              name: produkt.name,
                              kind: produkt.kind,
                              cenaBezDph: produkt.cenaBezDph,
                              sazbaId: produkt.sazbaId,
                              active: produkt.active,
                              url: produkt.url,
                              validityMonths: produkt.validityMonths,
                              prodano: produkt.prodano,
                            }}
                          />
                        </TableCell>
                      )}
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
