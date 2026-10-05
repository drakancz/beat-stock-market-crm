"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { upravDelkuHovoru } from "../klienti/actions";

/**
 * Délka hovoru, doplnitelná rovnou v tabulce.
 *
 * Hovor, který kdysi zapsal systém sám (přesunem případu do fáze Kontakt),
 * má nulu — systém neví,
 * jak dlouho se mluvilo. Obchodník ji doplní kliknutím na číslo, bez
 * otevírání celého formuláře.
 *
 * **Že se pole nezobrazí, není ochrana** — nárok si serverová akce
 * ověřuje sama.
 */
export function Delka({
  hovorId,
  minut,
  smiMenit,
}: {
  hovorId: string;
  minut: number;
  smiMenit: boolean;
}) {
  const router = useRouter();
  const [upravuje, setUpravuje] = useState(false);
  const [text, setText] = useState(String(minut));
  const [ceka, zahaj] = useTransition();

  if (!smiMenit) {
    return (
      <span className="text-muted-foreground text-xs">
        {minut > 0 ? `${minut} min` : "délka nedoplněna"}
      </span>
    );
  }

  if (!upravuje) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 h-auto px-2 py-0.5 text-xs font-normal"
        onClick={() => {
          setText(String(minut));
          setUpravuje(true);
        }}
      >
        {minut > 0 ? `${minut} min` : "doplnit délku"}
      </Button>
    );
  }

  function uloz() {
    zahaj(async () => {
      const vysledek = await upravDelkuHovoru(hovorId, text);

      if (!vysledek.ok) {
        // Pole zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
        toast.error(vysledek.chyba);
        return;
      }

      toast.success(vysledek.zprava);
      setUpravuje(false);
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        max={600}
        value={text}
        onChange={(udalost) => setText(udalost.target.value)}
        onKeyDown={(udalost) => {
          if (udalost.key === "Enter") uloz();
          if (udalost.key === "Escape") setUpravuje(false);
        }}
        autoFocus
        className="h-8 w-20"
        aria-label="Délka hovoru v minutách"
      />
      <Button size="sm" variant="ghost" onClick={uloz} disabled={ceka} aria-label="Uložit délku">
        {ceka ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setUpravuje(false)}
        disabled={ceka}
        aria-label="Zrušit"
      >
        <X />
      </Button>
    </span>
  );
}
