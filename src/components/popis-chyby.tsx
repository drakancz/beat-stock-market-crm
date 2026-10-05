"use client";

import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Ikonka ⓘ u chyby — co přesně cizí služba odpověděla (Jakub, 13. 9. 2026,
 * od 15. 9. v sekci Chyby). Na kliknutí, ne na najetí myší, aby to šlo
 * i na dotyku. Text přichází ze serveru už bez e-mailových adres.
 */
export function PopisChyby({ detail, popisek }: { detail: string | null; popisek: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Podrobnosti: ${popisek}`}>
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Co přesně se stalo</PopoverTitle>
          <PopoverDescription className="break-words whitespace-pre-wrap">
            {detail ??
              "Podrobnosti nejsou k dispozici — chyba vznikla dřív, než se začaly ukládat. Po dalším pokusu se doplní."}
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}
