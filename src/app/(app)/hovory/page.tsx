import type { Metadata } from "next";
import Link from "next/link";
import { Download, PhoneCall, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { filtrujiSeHovory, prectiFiltrHovoru, type Parametry } from "@/lib/filtry";
import { formatDatumCas } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import {
  nactiHovory,
  nactiKlientyProVyber,
  nactiProduktyProVyber,
  nactiPrirazitelne,
} from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { OUTCOME_LABEL } from "@/lib/types";

import { Delka } from "./delka";
import { FiltryHovoru } from "./filtry-hovoru";
import { Poznamka } from "./poznamka";
import { HovorDialog } from "../klienti/hovor-dialog";
import { SmazaniHovoru } from "../klienti/smazani-hovoru";

export const metadata: Metadata = { title: "Hovory" };

export const dynamic = "force-dynamic";

/** Adresa exportu se stejnými filtry, jaké jsou zrovna na obrazovce. */
function odkazNaExport(parametry: Parametry): string {
  const dotaz = new URLSearchParams();

  for (const [klic, hodnota] of Object.entries(parametry)) {
    const text = Array.isArray(hodnota) ? hodnota[0] : hodnota;
    if (text) dotaz.set(klic, text);
  }

  const retezec = dotaz.toString();
  return retezec ? `/hovory/export?${retezec}` : "/hovory/export";
}

/**
 * Přehled hovorů.
 *
 * **Vidí ho každý přihlášený** a od 22. 9. 2026 vidí všichni totéž —
 * klienti se nikomu nepřiřazují. Rozsah je pořád v dotazu
 * (`nactiHovory()` v `src/lib/queries.ts`), ne ve výpisu.
 *
 * **Zapsat hovor smí každý, kdo klienta vidí; poznámku a délku přepíše
 * autor hovoru a administrátor.** Exportovat smí každý, kdo obrazovku
 * vidí — soubor drží tentýž rozsah role i tytéž filtry, ale **bez textu
 * poznámky** (Jakub, 9. 9. 2026).
 *
 * **Smazat hovor smí autor hovoru a administrátor** (Jakub, 10. 9. 2026)
 * — stejně jako na kartě klienta. Smazaný hovor se objeví ve Smazaných
 * v tabulce Hovory, odkud ho administrátor umí vrátit.
 */
export default async function HovoryPage({ searchParams }: PageProps<"/hovory">) {
  const viewer = await requireViewer();

  const parametry = await searchParams;
  const filtr = prectiFiltrHovoru(parametry);

  const [hovory, klienti, produkty, tym] = await Promise.all([
    nactiHovory(viewer, filtr),
    nactiKlientyProVyber(viewer),
    nactiProduktyProVyber(),
    // Do filtru „Kdo zapsal" — autorství hovoru platí dál.
    nactiPrirazitelne(),
  ]);

  const filtruje = filtrujiSeHovory(filtr);
  const automatickych = hovory.filter((hovor) => hovor.outcome === "AUTOMATICKY").length;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">Hovory</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Telefonáty s klienty od nejnovějšího, u všech klientů.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" disabled={hovory.length === 0}>
            {/*
             * Obyčejný odkaz, ne serverová akce: prohlížeč má soubor
             * stáhnout, ne překreslit stránku. Filtry se do adresy
             * přenášejí, aby soubor odpovídal tomu, co je vidět.
             */}
            <a href={odkazNaExport(parametry)}>
              <Download />
              Export do CSV
            </a>
          </Button>
          <HovorDialog klienti={klienti} produkty={produkty} />
        </div>
      </div>

      <FiltryHovoru lide={tym} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Seznam hovorů
          </CardTitle>
          <CardDescription>
            {hovory.length === 0
              ? "Zatím tu není žádný hovor."
              : `${pocet(hovory.length, "hovor", "hovory", "hovorů")}${
                  automatickych > 0
                    ? `, z toho ${automatickych} zapsal systém sám ještě za obchodních případů`
                    : ""
                }.`}
          </CardDescription>
          {hovory.length > 0 && (
            <CardAction>
              <span className="text-muted-foreground text-xs">
                Délku i poznámku přepíšeš rovnou v tabulce.
              </span>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {hovory.length === 0 ? (
            filtruje ? (
              <EmptyState
                icon={SearchX}
                title="Nic neodpovídá filtrům."
                description="Zkus je zrušit nebo hledat jinak."
              />
            ) : (
              <EmptyState
                icon={PhoneCall}
                title="Žádné hovory."
                description="Zapiš první tlačítkem nahoře — z karty klienta nebo odsud."
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Datum</TableHead>
                    <TableHead>Kdo zapsal</TableHead>
                    <TableHead>Klient</TableHead>
                    <TableHead>Objednávka</TableHead>
                    <TableHead>Výsledek</TableHead>
                    <TableHead className="min-w-[16rem]">Poznámka</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hovory.map((hovor) => {
                    // Že se tužka nezobrazí, není ochrana — serverová akce
                    // si nárok ověřuje sama.
                    const smiMenit = viewer.role === "ADMINISTRATOR" || hovor.userId === viewer.id;

                    return (
                      <TableRow key={hovor.id} className="align-top">
                        <TableCell className="whitespace-nowrap">
                          <span className="tabular block">{formatDatumCas(hovor.at)}</span>
                          <Delka hovorId={hovor.id} minut={hovor.durationMin} smiMenit={smiMenit} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{hovor.userName}</TableCell>
                        <TableCell>
                          <Link
                            href={`/klienti/${hovor.clientId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {hovor.clientName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {hovor.orderId ? (
                            <Link
                              href={`/objednavky?hledat=${encodeURIComponent(hovor.orderNumber ?? "")}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {hovor.orderNumber}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge
                            variant={hovor.outcome === "AUTOMATICKY" ? "outline" : "secondary"}
                          >
                            {OUTCOME_LABEL[hovor.outcome]}
                          </Badge>
                          {hovor.productName && (
                            <span className="text-muted-foreground mt-1 block text-xs">
                              Zájem: {hovor.productName}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Poznamka hovorId={hovor.id} poznamka={hovor.note} smiMenit={smiMenit} />
                        </TableCell>
                        <TableCell className="text-right">
                          {smiMenit && (
                            <SmazaniHovoru
                              hovor={{
                                id: hovor.id,
                                popis: `${OUTCOME_LABEL[hovor.outcome]} s klientem ${hovor.clientName} z ${formatDatumCas(hovor.at)}`,
                              }}
                            />
                          )}
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

      <PoznamkaPodCarou>
        Hovor označený <strong>Zapsáno automaticky</strong> vznikl sám za časů obchodních případů
        (do 22. 9. 2026); nové takové už nepřibývají. Export drží použité filtry, ale
        <strong> text poznámky v souboru není</strong> — obsah hovorů zůstává v systému.
      </PoznamkaPodCarou>
    </>
  );
}
