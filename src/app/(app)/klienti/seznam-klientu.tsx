"use client";

import { useState } from "react";
import Link from "next/link";
import { PanelRight } from "lucide-react";

import { Stitek } from "@/components/stitky/stitek";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TagColor } from "@/generated/prisma/enums";
import { formatDatum, formatTelefon } from "@/lib/format";
import type { nactiKlienty } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { HromadneAkce } from "./hromadne-akce";
import { NahledKlienta } from "./nahled-klienta";
import { PristupDoProgramu } from "./pristup-do-programu";

type Radek = Awaited<ReturnType<typeof nactiKlienty>>[number];

/**
 * Tabulka klientů s výběrem pro hromadné akce (Fáze 5B, Jakub 11. 10. 2026).
 * Do té doby byla tabulka přímo ve stránce. Výběr žije jen v prohlížeči;
 * co se s vybranými smí, hlídají serverové akce.
 */
export function SeznamKlientu({
  klienti,
  stitky,
  jeAdmin,
  body,
}: {
  klienti: Radek[];
  stitky: { id: string; name: string; color: TagColor }[];
  jeAdmin: boolean;
  /** Body klientů podle id (Fáze 5C, 18. 10. 2026). */
  body: Record<string, number>;
}) {
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());
  // Rychlý náhled z boku (Fáze 5B, 18. 10. 2026) — id otevřeného klienta.
  const [nahled, setNahled] = useState<string | null>(null);
  // Po změně filtru zůstanou vybraní jen ti, kdo jsou pořád vidět.
  const viditelne = new Set(klienti.map((k) => k.id));
  const platneVybrane = [...vybrane].filter((id) => viditelne.has(id));
  const vse = klienti.length > 0 && platneVybrane.length === klienti.length;

  function prepni(id: string, ano: boolean) {
    setVybrane((pred) => {
      const dalsi = new Set(pred);
      if (ano) dalsi.add(id);
      else dalsi.delete(id);
      return dalsi;
    });
  }

  return (
    <div className="space-y-3">
      {platneVybrane.length > 0 && (
        <HromadneAkce
          vybrane={platneVybrane}
          stitky={stitky}
          jeAdmin={jeAdmin}
          zrusitVyber={() => setVybrane(new Set())}
        />
      )}
      {/* Tabulka se na úzkém displeji posouvá do strany, stránka nikdy. */}
      <div className="-mx-2 overflow-x-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={vse ? true : platneVybrane.length > 0 ? "indeterminate" : false}
                  onCheckedChange={(stav) =>
                    setVybrane(stav === true ? new Set(klienti.map((k) => k.id)) : new Set())
                  }
                  aria-label="Vybrat všechny klienty v seznamu"
                />
              </TableHead>
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
              {/* Body za vzdělávání (Fáze 5C, 18. 10. 2026), jen na širší obrazovce. */}
              <TableHead className="hidden text-right xl:table-cell">Body</TableHead>
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
                  <Checkbox
                    checked={vybrane.has(klient.id)}
                    onCheckedChange={(stav) => prepni(klient.id, stav === true)}
                    aria-label={`Vybrat: ${klient.name}`}
                  />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <Link
                      href={`/klienti/${klient.id}`}
                      className="font-medium whitespace-nowrap hover:underline"
                    >
                      {klient.name}
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      onClick={() => setNahled(klient.id)}
                      aria-label={`Náhled: ${klient.name}`}
                      title="Rychlý náhled"
                    >
                      <PanelRight />
                    </Button>
                  </span>
                  {/*
                    E-mail i telefon pod jménem, každý na svém řádku
                    (Jakub, 23. 9. 2026). Co chybí, se nevypisuje.
                  */}
                  {klient.email && (
                    <span className="text-muted-foreground block text-xs">{klient.email}</span>
                  )}
                  {klient.phone && (
                    <span className="text-muted-foreground tabular block text-xs whitespace-nowrap">
                      {formatTelefon(klient.phone)}
                    </span>
                  )}
                  {/* Štítky (Fáze 5B, 11. 10. 2026). */}
                  {klient.stitky.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {klient.stitky.map((stitek) => (
                        <Stitek key={stitek.id} nazev={stitek.name} barva={stitek.color} />
                      ))}
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
                <TableCell className="tabular hidden text-right xl:table-cell">
                  {body[klient.id] ?? 0}
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
                  {/* Platí, ale nechodí (Fáze 5B, 15. 10. 2026). */}
                  {klient.nechodi && (
                    <Badge
                      variant="outline"
                      className="mt-1 ml-auto block w-fit"
                      title="Platí členství, ale klientská část je dlouho bez návštěvy"
                    >
                      Nechodí
                    </Badge>
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
      <NahledKlienta
        poradi={klienti.map((klient) => ({ id: klient.id, name: klient.name }))}
        otevreny={nahled}
        zavrit={() => setNahled(null)}
        otevrit={setNahled}
      />
    </div>
  );
}
