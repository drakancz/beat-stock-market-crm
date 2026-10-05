"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AUTO_CONNECT_LABEL } from "@/lib/types";
import type { BrokerAutoConnect } from "@/generated/prisma/enums";

const VSE = "vse";
const PRODLEVA_MS = 300;

const MOZNOSTI: BrokerAutoConnect[] = ["ANO", "PRAVDEPODOBNE", "ZATIM_NE"];

/**
 * Hledání a filtr nad seznamem brokerů.
 *
 * Stejný postup jako u klientů: nastavení žije v adrese, seznam načte
 * server znovu už omezený. Při každé změně se zahazuje číslo stránky —
 * jinak by po zúžení výběru zůstal člověk na páté stránce, která už
 * neexistuje, a viděl by prázdno.
 */
export function FiltryBrokeru() {
  const router = useRouter();
  const pathname = usePathname();
  const parametry = useSearchParams();
  const [ceka, zahaj] = useTransition();

  const hledatVAdrese = parametry.get("hledat") ?? "";
  const [hledat, setHledat] = useState(hledatVAdrese);
  const [posledniZAdresy, setPosledniZAdresy] = useState(hledatVAdrese);

  if (hledatVAdrese !== posledniZAdresy) {
    setPosledniZAdresy(hledatVAdrese);
    setHledat(hledatVAdrese);
  }

  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (casovac.current) clearTimeout(casovac.current);
    },
    [],
  );

  function prejdi(zmeny: Record<string, string | null>) {
    const dalsi = new URLSearchParams(parametry.toString());

    for (const [klic, hodnota] of Object.entries(zmeny)) {
      if (hodnota === null || hodnota === "") dalsi.delete(klic);
      else dalsi.set(klic, hodnota);
    }

    dalsi.delete("stranka");

    const dotaz = dalsi.toString();
    zahaj(() => router.replace(dotaz ? `${pathname}?${dotaz}` : pathname, { scroll: false }));
  }

  function napsano(hodnota: string) {
    setHledat(hodnota);
    if (casovac.current) clearTimeout(casovac.current);
    casovac.current = setTimeout(() => prejdi({ hledat: hodnota.trim() || null }), PRODLEVA_MS);
  }

  const napojeni = parametry.get("napojeni") ?? VSE;
  const filtrujeSe = Boolean(hledatVAdrese || parametry.get("napojeni"));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:max-w-xs sm:flex-1">
        <Input
          value={hledat}
          onChange={(udalost) => napsano(udalost.target.value)}
          placeholder="Název brokera…"
          aria-label="Hledat mezi brokery"
          maxLength={100}
          className="pr-8"
        />
        {ceka && (
          <Loader2
            className="text-muted-foreground absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin"
            aria-hidden
          />
        )}
      </div>

      <Select
        value={napojeni}
        onValueChange={(hodnota) => prejdi({ napojeni: hodnota === VSE ? null : hodnota })}
      >
        <SelectTrigger className="sm:w-56" aria-label="Filtrovat podle napojení">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={VSE}>Napojení: všechna</SelectItem>
          {MOZNOSTI.map((moznost) => (
            <SelectItem key={moznost} value={moznost}>
              Napojení: {AUTO_CONNECT_LABEL[moznost].toLowerCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtrujeSe && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => zahaj(() => router.replace(pathname, { scroll: false }))}
        >
          <X />
          Zrušit filtry
        </Button>
      )}
    </div>
  );
}
