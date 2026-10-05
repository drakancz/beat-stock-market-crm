"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/** Jak dlouho se po posledním úhozu čeká, než se seznam načte znovu. */
const PRODLEVA_MS = 300;

/**
 * Filtry nad seznamem klientů.
 *
 * Nastavení se ukládá **do adresy**, ne do stavu komponenty — odkaz na
 * vyfiltrovaný seznam se dá poslat kolegovi a po obnovení stránky zůstane
 * totéž. Seznam pak načte server znovu už omezený, takže se do prohlížeče
 * neposílají klienti, které pak jen schováme.
 *
 * Výběr „podle obchodníka" tu byl do 22. 9. 2026 — klienti se od té doby
 * nikomu nepřiřazují, takže nemá co filtrovat. Výběr podle stavu zanikl
 * 23. 9. 2026 spolu se sloupcem Stav (Jakub).
 */
export function FiltryKlientu() {
  const router = useRouter();
  const pathname = usePathname();
  const parametry = useSearchParams();
  const [ceka, zahaj] = useTransition();

  const hledatVAdrese = parametry.get("hledat") ?? "";
  const [hledat, setHledat] = useState(hledatVAdrese);
  const [posledniZAdresy, setPosledniZAdresy] = useState(hledatVAdrese);

  // Když se adresa změní jinudy (tlačítko Zrušit filtry, hledání v horní
  // liště, krok zpět v prohlížeči), musí se políčko srovnat s ní. Dělá se
  // to při vykreslení, ne v efektu — jinak by se obrazovka překreslila
  // dvakrát a políčko na okamžik ukázalo starou hodnotu.
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
    // `replace`, ne `push` — jinak by se každé písmeno uložilo do historie
    // prohlížeče a tlačítko zpět by se muselo mačkat dvacetkrát.
    zahaj(() => router.replace(dotaz ? `${pathname}?${dotaz}` : pathname, { scroll: false }));
  }

  function napsano(hodnota: string) {
    setHledat(hodnota);
    if (casovac.current) clearTimeout(casovac.current);
    // Bez prodlevy by se dotaz do databáze poslal po každém úhozu.
    casovac.current = setTimeout(() => prejdi({ hledat: hodnota.trim() || null }), PRODLEVA_MS);
  }

  const filtrujeSe = Boolean(hledatVAdrese);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:max-w-xs sm:min-w-56 sm:flex-1">
        <Input
          name="hledat"
          value={hledat}
          onChange={(udalost) => napsano(udalost.target.value)}
          placeholder="Jméno, e-mail nebo telefon…"
          aria-label="Hledat mezi klienty"
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
