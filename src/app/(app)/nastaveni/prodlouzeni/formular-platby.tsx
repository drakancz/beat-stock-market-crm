"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ulozPripominkyPlatby } from "./actions";

/** Připomínka nezaplacené objednávky (Fáze 5A, 11. 10. 2026). Jen administrátor. */
export function FormularPripominekPlatby({
  zapnuto,
  prvniDnu,
  druhaDnu,
}: {
  zapnuto: boolean;
  prvniDnu: number;
  druhaDnu: number;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozPripominkyPlatby(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div
        role="radiogroup"
        aria-label="Posílat připomínky?"
        className="flex flex-wrap gap-x-6 gap-y-2"
      >
        {(
          [
            ["ano", "Posílat připomínky"],
            ["ne", "Vypnuto"],
          ] as const
        ).map(([volba, popisek]) => (
          <label key={volba} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="zapnuto"
              value={volba}
              required
              defaultChecked={(zapnuto ? "ano" : "ne") === volba}
              className="accent-primary size-4"
            />
            {popisek}
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="paymentReminderFirstDays">První připomínka po (dnech)</Label>
          <Input
            id="paymentReminderFirstDays"
            name="paymentReminderFirstDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            required
            defaultValue={prvniDnu}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paymentReminderSecondDays">Druhá připomínka po (dnech)</Label>
          <Input
            id="paymentReminderSecondDays"
            name="paymentReminderSecondDays"
            type="number"
            inputMode="numeric"
            min={2}
            max={60}
            required
            defaultValue={druhaDnu}
          />
        </div>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit připomínky
      </Button>
    </form>
  );
}
