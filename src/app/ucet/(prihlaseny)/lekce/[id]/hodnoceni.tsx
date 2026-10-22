"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ohodnotLekci } from "../../kurzy/actions";

/**
 * „Pomohla vám lekce?“ 1–5 hvězdiček pod lekcí (Fáze 5C, 18. 10. 2026).
 * Klient může hodnocení kdykoli změnit; ukládá se hned po kliknutí.
 */
export function HodnoceniLekce({
  lekceId,
  hodnoceni,
  nejvic,
}: {
  lekceId: string;
  hodnoceni: number | null;
  nejvic: number;
}) {
  const [hvezd, setHvezd] = useState(hodnoceni);
  const [ceka, zahaj] = useTransition();

  function ohodnot(nove: number) {
    const predtim = hvezd;
    setHvezd(nove);
    zahaj(async () => {
      const vysledek = await ohodnotLekci(lekceId, nove);
      if (!vysledek.ok) {
        setHvezd(predtim);
        toast.error(vysledek.chyba);
        return;
      }
      toast.success("Děkujeme za hodnocení.");
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium" id={`hodnoceni-${lekceId}`}>
          Pomohla vám lekce?
        </p>
        <div role="group" aria-labelledby={`hodnoceni-${lekceId}`} className="flex gap-1">
          {Array.from({ length: nejvic }, (_, i) => i + 1).map((cislo) => {
            const plna = hvezd !== null && cislo <= hvezd;
            return (
              <button
                key={cislo}
                type="button"
                disabled={ceka}
                onClick={() => ohodnot(cislo)}
                aria-pressed={hvezd === cislo}
                aria-label={`${cislo} z ${nejvic}`}
                className="focus-visible:ring-ring/50 rounded-md p-1.5 outline-none focus-visible:ring-3 disabled:opacity-60"
              >
                <Star
                  className={cn(
                    "size-7",
                    plna ? "fill-primary text-primary" : "text-muted-foreground",
                  )}
                />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
