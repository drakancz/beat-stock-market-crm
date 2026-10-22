"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";

import { LogoBrokera } from "@/components/logo-brokera";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AUTO_CONNECT_LABEL } from "@/lib/types";
import type { BrokerAutoConnect } from "@/generated/prisma/enums";

import { BrokerDialog } from "./broker-dialog";
import { DoKoseDialog } from "./smazani-brokera";

export interface RadekBrokera {
  id: string;
  name: string;
  autoConnect: BrokerAutoConnect;
  website: string | null;
  logo: string | null;
  note: string | null;
}

/** Napojení „Ano" je dobrá zpráva, proto vystoupí; zbytek zůstává tichý. */
const ODSTIN: Record<BrokerAutoConnect, "default" | "secondary" | "outline"> = {
  ANO: "default",
  PRAVDEPODOBNE: "outline",
  ZATIM_NE: "secondary",
};

export function SeznamBrokeru({
  brokeri,
  jeAdmin,
}: {
  brokeri: RadekBrokera[];
  /**
   * Smí měnit? Sloupec s akcemi se ostatním vůbec nevykreslí.
   *
   * Není to ochrana — serverové akce si `requireAdmin()` volají samy.
   * Jde jen o to, aby obchodník neklikal na tlačítka, která mu systém
   * stejně odmítne.
   */
  jeAdmin: boolean;
}) {
  const router = useRouter();
  const [smazat, setSmazat] = useState<RadekBrokera | null>(null);

  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Broker</TableHead>
              <TableHead>Automatické napojení</TableHead>
              <TableHead className="hidden lg:table-cell">Poznámka</TableHead>
              {jeAdmin && <TableHead className="text-right">Akce</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {brokeri.map((broker) => (
              <TableRow key={broker.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <LogoBrokera nazev={broker.name} logo={broker.logo} />
                    <div className="min-w-0">
                      <Link
                        href={`/brokeri/${broker.id}`}
                        className="font-medium whitespace-nowrap hover:underline"
                      >
                        {broker.name}
                      </Link>
                      {broker.website && (
                        <a
                          href={broker.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                        >
                          Web
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={ODSTIN[broker.autoConnect]}>
                    {AUTO_CONNECT_LABEL[broker.autoConnect]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-xs truncate lg:table-cell">
                  {broker.note ?? <span aria-hidden>—</span>}
                </TableCell>
                {jeAdmin && (
                  <TableCell className="text-right whitespace-nowrap">
                    <BrokerDialog broker={broker} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSmazat(broker)}
                      title="Smazat brokera"
                    >
                      <Trash2 />
                      <span className="sr-only">Smazat {broker.name}</span>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DoKoseDialog
        broker={smazat}
        zavrit={() => setSmazat(null)}
        hotovo={() => {
          setSmazat(null);
          router.refresh();
        }}
      />
    </>
  );
}
