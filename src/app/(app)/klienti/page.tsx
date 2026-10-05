import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarX, CopyCheck, SearchX, Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireViewer } from "@/lib/session";
import { pocetDuplicit } from "@/lib/duplicity";
import { filtrujeSe, prectiFiltr } from "@/lib/filtry";
import { formatDatum, formatTelefon } from "@/lib/format";
import {
  nactiBrokery,
  nactiKlienty,
  nactiZdrojeKlientu,
  pocetCekajicichNaPristup,
  pocetPoKonciSPristupem,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

import { FiltryKlientu } from "./filtry-klientu";
import { KlientDialog } from "./klient-dialog";
import { PristupDoProgramu } from "./pristup-do-programu";

export const metadata: Metadata = { title: "Klienti" };

export const dynamic = "force-dynamic";

export default async function KlientiPage({ searchParams }: PageProps<"/klienti">) {
  const viewer = await requireViewer();

  const filtr = prectiFiltr(await searchParams);
  const [klienti, vsichniBrokeri, zdroje, cekaNaPristup, poKonciSPristupem, duplicit] =
    await Promise.all([
      nactiKlienty(viewer, filtr),
      nactiBrokery(),
      nactiZdrojeKlientu(),
      pocetCekajicichNaPristup(viewer),
      pocetPoKonciSPristupem(viewer),
      pocetDuplicit(),
    ]);

  // Přístup do programu přepíná jen administrátor (Jakub, 23. 9. 2026).
  // Výběr je jen úklid v rozhraní — hlídá to `zmenPristupKlienta()`.
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  // Do zakládacího formuláře jdou jen název a id — nic víc dialog nepotřebuje.
  const brokeri = vsichniBrokeri.map((broker) => ({ id: broker.id, name: broker.name }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Klienti</h2>
          {/*
            Klienti se od 22. 9. 2026 nikomu nepřiřazují, takže všichni
            vidí totéž — není co vysvětlovat podle role.
          */}
          <p className="text-muted-foreground mt-1 text-sm">
            Všichni klienti CRM. Objednávky k nim chodí z Landing Page.
          </p>
        </div>
        <KlientDialog brokeri={brokeri} zdroje={zdroje} />
      </div>

      {/*
        Nedodělaná práce: klient zaplatil, ale přístup do programu nemá.
        Do 23. 9. 2026 bylo tohle upozornění v sekci Objednávky u objednávek;
        přístup je od té doby u klienta. Vidí ho každý — přístup sice
        zařizuje administrátor, ale kolega se klienta často zeptá dřív.
      */}
      {cekaNaPristup > 0 && (
        /*
          Světle zelená (Jakub, 23. 9. 2026), do té doby červená. Stejné
          odstíny jako políčko „Povolen" — `pristup-ano` v globals.css.
        */
        <Alert className="border-pristup-ano-foreground/25 bg-pristup-ano text-pristup-ano-foreground *:data-[slot=alert-description]:text-pristup-ano-foreground/90">
          <AlertTriangle />
          <AlertTitle>
            {cekaNaPristup === 1
              ? "Jeden klient zaplatil a čeká na přístup do programu"
              : `Klientů, kteří zaplatili a čekají na přístup do programu: ${cekaNaPristup}`}
          </AlertTitle>
          <AlertDescription>
            {cekaNaPristup === 1
              ? "Řádek klienta je v seznamu podbarvený."
              : "Jejich řádky jsou v seznamu podbarvené."}
            {jeAdmin
              ? " Přístup povolíš přímo ve sloupci Přístup do programu."
              : " Povolit ho může administrátor."}
          </AlertDescription>
        </Alert>
      )}

      {/*
        Členství skončilo, ale přístup do programu zůstal povolený (Jakub,
        25. 9. 2026). Přístup se sám nevypíná — tohle je jen upozornění.
        Vidí ho každý, vypnout ho smí administrátor.
      */}
      {poKonciSPristupem > 0 && (
        <Alert className="border-konec-clenstvi-foreground/25 bg-konec-clenstvi text-konec-clenstvi-foreground *:data-[slot=alert-description]:text-konec-clenstvi-foreground/90">
          <CalendarX />
          <AlertTitle>
            {poKonciSPristupem === 1
              ? "Jednomu klientovi skončilo členství, ale přístup do programu má pořád povolený"
              : `Klientů, kterým skončilo členství a přístup do programu mají pořád povolený: ${poKonciSPristupem}`}
          </AlertTitle>
          <AlertDescription>
            {poKonciSPristupem === 1
              ? "Řádek klienta je v seznamu podbarvený žlutě."
              : "Jejich řádky jsou v seznamu podbarvené žlutě."}
            {jeAdmin
              ? " Když členství neprodlouží, přístup vypneš přímo ve sloupci Přístup do programu."
              : " Vypnout přístup může administrátor."}
          </AlertDescription>
        </Alert>
      )}

      {/*
        Možné duplicity (Jakub, 27. 9. 2026, krok 2B). Vidí každý, sloučit
        smí administrátor na stránce Možné duplicity.
      */}
      {duplicit > 0 && (
        <Alert>
          <CopyCheck />
          <AlertTitle>
            {duplicit === 1
              ? "Jedna dvojice klientů je nejspíš stejný člověk"
              : `Dvojic klientů, které jsou nejspíš stejný člověk: ${duplicit}`}
          </AlertTitle>
          <AlertDescription>
            <span>
              Mají stejný telefon nebo stejné jméno.{" "}
              <Link href="/klienti/duplicity" className="font-medium underline underline-offset-4">
                Zobrazit možné duplicity
              </Link>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4">
          <FiltryKlientu />

          {klienti.length === 0 ? (
            filtrujeSe(filtr) ? (
              <EmptyState
                icon={SearchX}
                title="Nikdo neodpovídá zadání."
                description="Zkus jiné jméno nebo zruš filtry."
              />
            ) : (
              <EmptyState
                icon={Users}
                title="Zatím tu nejsou žádní klienti."
                description="Klienti přibudou s první objednávkou z Landing Page, nebo je založ tlačítkem nahoře."
              />
            )
          ) : (
            /* Tabulka se na úzkém displeji posouvá do strany, stránka nikdy. */
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    {/*
                      Sloupce Stav, Portfolia a Poslední kontakt zanikly
                      23. 9. 2026 (Jakub). Místo nich počet a datum
                      poslední objednávky — CRM teď eviduje objednávky
                      z Landing Page, ne obchodní proces. Stav zůstal na
                      kartě klienta a ve formuláři.
                    */}
                    <TableHead>Klient</TableHead>
                    <TableHead className="hidden lg:table-cell">Zdroj</TableHead>
                    <TableHead className="text-right">Počet objednávek</TableHead>
                    <TableHead className="text-right">Poslední objednávka</TableHead>
                    {/* Od 24. 9. 2026 — nejbližší konec členství. */}
                    <TableHead className="text-right">Platnost do</TableHead>
                    {/* Od 23. 9. 2026 — přesunuto ze sekce Objednávky. */}
                    <TableHead>Přístup do programu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {klienti.map((klient) => (
                    <TableRow
                      key={klient.id}
                      className={cn(
                        // Členství skončilo, přístup pořád povolen (Jakub, 25. 9. 2026).
                        klient.platnost?.skoncilo &&
                          klient.programAccess === "POVOLEN" &&
                          "bg-konec-clenstvi/70 hover:bg-konec-clenstvi",
                        klient.zaplatil &&
                          klient.programAccess === "NEPOVOLEN" &&
                          "bg-destructive/5 hover:bg-destructive/10",
                      )}
                    >
                      <TableCell>
                        <Link
                          href={`/klienti/${klient.id}`}
                          className="font-medium whitespace-nowrap hover:underline"
                        >
                          {klient.name}
                        </Link>
                        {/*
                          E-mail i telefon pod jménem, každý na svém řádku
                          (Jakub, 23. 9. 2026). Co chybí, se nevypisuje.
                        */}
                        {klient.email && (
                          <span className="text-muted-foreground block text-xs">
                            {klient.email}
                          </span>
                        )}
                        {klient.phone && (
                          <span className="text-muted-foreground tabular block text-xs whitespace-nowrap">
                            {formatTelefon(klient.phone)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden lg:table-cell">
                        {klient.source}
                      </TableCell>
                      <TableCell className="tabular text-right">{klient.pocetObjednavek}</TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {klient.posledniObjednavka ? (
                          formatDatum(klient.posledniObjednavka)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {klient.platnost === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : klient.platnost.skoncilo ? (
                          <span className="text-muted-foreground">
                            skončilo {formatDatum(klient.platnost.do)}
                          </span>
                        ) : (
                          formatDatum(klient.platnost.do)
                        )}
                      </TableCell>
                      <TableCell>
                        <PristupDoProgramu
                          klient={{
                            id: klient.id,
                            name: klient.name,
                            programAccess: klient.programAccess,
                            zaplatil: klient.zaplatil,
                          }}
                          smiMenit={jeAdmin}
                        />
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
