"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CALL_OUTCOMES, OUTCOME_LABEL } from "@/lib/types";

/** Hodnota, kterou se ve výběru myslí „bez omezení". Prázdný řetězec Select neumí. */
const VSE = "vse";

/** Jak dlouho se po posledním úhozu čeká, než se seznam načte znovu. */
const PRODLEVA_MS = 300;

export interface ClenTymu {
  id: string;
  name: string;
}

/**
 * Filtry nad hovory.
 *
 * Nastavení se ukládá **do adresy**, ne do stavu komponenty — odkaz na
 * vyfiltrovaný přehled se dá poslat kolegovi a po obnovení stránky
 * zůstane totéž. Bere si je i tlačítko Export, takže soubor odpovídá
 * tomu, co je na obrazovce.
 *
 * Filtry nic neodkrývají: server je skládá přes `AND` s rozsahem role,
 * takže cizí hovor se přes ně vytáhnout nedá.
 */
export function FiltryHovoru({ lide }: { lide: ClenTymu[] }) {
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

  const vysledek = parametry.get("vysledek") ?? VSE;
  const kdoZapsal = parametry.get("kdo") ?? VSE;
  const od = parametry.get("od") ?? "";
  const doKdy = parametry.get("do") ?? "";

  const filtrujeSe = Boolean(
    hledatVAdrese ||
    parametry.get("vysledek") ||
    parametry.get("kdo") ||
    parametry.get("od") ||
    parametry.get("do"),
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="relative sm:max-w-xs sm:flex-1">
        <Label htmlFor="hledat" className="text-muted-foreground mb-1.5 text-xs">
          Hledat
        </Label>
        <Input
          id="hledat"
          value={hledat}
          onChange={(udalost) => napsano(udalost.target.value)}
          placeholder="Klient, objednávka nebo text poznámky…"
          maxLength={100}
          className="pr-8"
        />
        {ceka && (
          <Loader2
            className="text-muted-foreground absolute right-2.5 bottom-2.5 size-4 animate-spin"
            aria-hidden
          />
        )}
      </div>

      <div>
        <Label className="text-muted-foreground mb-1.5 text-xs">Výsledek</Label>
        <Select
          value={vysledek}
          onValueChange={(hodnota) => prejdi({ vysledek: hodnota === VSE ? null : hodnota })}
        >
          <SelectTrigger className="sm:w-52" aria-label="Filtrovat podle výsledku">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VSE}>Všechny výsledky</SelectItem>
            {CALL_OUTCOMES.map((polozka) => (
              <SelectItem key={polozka} value={polozka}>
                {OUTCOME_LABEL[polozka]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/*
       * Filtruje se podle toho, **kdo hovor zapsal** — autorství platí
       * dál, i když se klienti nikomu nepřiřazují (Jakub, 22. 9. 2026).
       * Dřív se výběr schovával obchodníkovi, který viděl jen své hovory.
       */}
      {lide.length > 0 && (
        <div>
          <Label className="text-muted-foreground mb-1.5 text-xs">Kdo zapsal</Label>
          <Select
            value={kdoZapsal}
            onValueChange={(hodnota) => prejdi({ kdo: hodnota === VSE ? null : hodnota })}
          >
            <SelectTrigger className="sm:w-52" aria-label="Filtrovat podle toho, kdo hovor zapsal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VSE}>Kdokoli</SelectItem>
              {lide.map((polozka) => (
                <SelectItem key={polozka.id} value={polozka.id}>
                  {polozka.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="od" className="text-muted-foreground mb-1.5 text-xs">
          Od
        </Label>
        <Input
          id="od"
          type="date"
          value={od}
          max={doKdy || undefined}
          onChange={(udalost) => prejdi({ od: udalost.target.value || null })}
          className="w-auto"
        />
      </div>

      <div>
        <Label htmlFor="do" className="text-muted-foreground mb-1.5 text-xs">
          Do
        </Label>
        <Input
          id="do"
          type="date"
          value={doKdy}
          min={od || undefined}
          onChange={(udalost) => prejdi({ do: udalost.target.value || null })}
          className="w-auto"
        />
      </div>

      {filtrujeSe && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => prejdi({ hledat: null, vysledek: null, kdo: null, od: null, do: null })}
        >
          <X />
          Zrušit filtry
        </Button>
      )}
    </div>
  );
}
