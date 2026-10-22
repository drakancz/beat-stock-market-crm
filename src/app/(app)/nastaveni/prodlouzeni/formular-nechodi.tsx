"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ulozHraniciNechodi } from "./actions";

/** Hranice „platí, ale nechodí“ (Fáze 5B, 15. 10. 2026) — jen administrátor (hlídá akce). */
export function FormularNechodi({ dni }: { dni: number }) {
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
          const vysledek = await ulozHraniciNechodi(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div className="max-w-xs space-y-2">
        <Label htmlFor="inactiveMemberDays">Po kolika dnech bez návštěvy</Label>
        <Input
          id="inactiveMemberDays"
          name="inactiveMemberDays"
          type="number"
          inputMode="numeric"
          min={7}
          max={180}
          required
          defaultValue={dni}
        />
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit
      </Button>
    </form>
  );
}
