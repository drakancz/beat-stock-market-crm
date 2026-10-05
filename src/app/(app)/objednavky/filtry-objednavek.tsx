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
import { ORDER_STATUSES } from "@/lib/types";

import { FiltrCasu, PARAMETRY_CASU } from "./filtr-casu";
import type { Volba } from "./vyber";

/** Hodnota, kterou se ve výběru myslí „bez omezení". Prázdný řetězec Select neumí. */
const VSE = "vse";

/** Jak dlouho se po posledním úhozu čeká, než se seznam načte znovu. */
const PRODLEVA_MS = 300;

/**
 * Filtry nad objednávkami.
 *
 * Nastavení se ukládá **do adresy**, ne do stavu komponenty — odkaz na
 * vyfiltrovaný seznam se dá poslat kolegovi a po obnovení stránky
 * zůstane totéž.
 *
 * Filtry nic neodkrývají: server je skládá přes `AND` s rozsahem role,
 * takže cizí objednávka se přes ně nedá vytáhnout.
 */
export function FiltryObjednavek({ klienti, roky }: { klienti: Volba[]; roky: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const parametry = useSearchParams();
  const [ceka, zahaj] = useTransition();

  const hledatVAdrese = parametry.get("hledat") ?? "";
  const [hledat, setHledat] = useState(hledatVAdrese);
  const [posledniZAdresy, setPosledniZAdresy] = useState(hledatVAdrese);

  // Když se adresa změní jinudy (Zrušit filtry, krok zpět v prohlížeči),
  // musí se políčko srovnat s ní.
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

    const dotaz = dalsi.toString();
    // `replace`, ne `push` — jinak by se každé písmeno uložilo do historie.
    zahaj(() => router.replace(dotaz ? `${pathname}?${dotaz}` : pathname, { scroll: false }));
  }

  function napsano(hodnota: string) {
    setHledat(hodnota);
    if (casovac.current) clearTimeout(casovac.current);
    casovac.current = setTimeout(() => prejdi({ hledat: hodnota.trim() || null }), PRODLEVA_MS);
  }

  const stav = parametry.get("stav") ?? VSE;
  const klient = parametry.get("klient") ?? VSE;
  const den = parametry.get("den");
  const mesic = parametry.get("mesic");
  const rok = parametry.get("rok");
  const filtrujeSe = Boolean(
    hledatVAdrese || parametry.get("stav") || parametry.get("klient") || den || mesic || rok,
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:max-w-xs sm:min-w-56 sm:flex-1">
        <Input
          value={hledat}
          onChange={(udalost) => napsano(udalost.target.value)}
          placeholder="Číslo objednávky, klient nebo produkt…"
          aria-label="Hledat mezi objednávkami"
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

      {/* Čas objednávky před stavem (Jakub, 24. 9. 2026). */}
      <FiltrCasu den={den} mesic={mesic} rok={rok} roky={roky} prejdi={prejdi} />

      <Select
        value={stav}
        onValueChange={(hodnota) => prejdi({ stav: hodnota === VSE ? null : hodnota })}
      >
        <SelectTrigger className="sm:w-48" aria-label="Filtrovat podle stavu">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={VSE}>Všechny stavy</SelectItem>
          {ORDER_STATUSES.map((polozka) => (
            <SelectItem key={polozka.id} value={polozka.id}>
              {polozka.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={klient}
        onValueChange={(hodnota) => prejdi({ klient: hodnota === VSE ? null : hodnota })}
      >
        <SelectTrigger className="sm:w-56" aria-label="Filtrovat podle klienta">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={VSE}>Všichni klienti</SelectItem>
          {klienti.map((polozka) => (
            <SelectItem key={polozka.id} value={polozka.id}>
              {polozka.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtrujeSe && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => prejdi({ hledat: null, stav: null, klient: null, ...PARAMETRY_CASU })}
        >
          <X />
          Zrušit filtry
        </Button>
      )}
    </div>
  );
}
