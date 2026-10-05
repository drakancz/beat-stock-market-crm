"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import type { TwoFactorPolicy } from "@/generated/prisma/enums";

import { ulozZabezpeceni } from "./actions";

const POLITIKY: { id: TwoFactorPolicy; label: string }[] = [
  { id: "NIKDO", label: "Nikdo — každý si ho zapíná sám" },
  { id: "ADMINISTRATORI", label: "Administrátoři" },
  { id: "VSICHNI", label: "Všichni" },
];

export function FormularZabezpeceni({
  politika,
  hodin,
  maxHodin,
}: {
  politika: TwoFactorPolicy;
  hodin: number;
  maxHodin: number;
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
          const vysledek = await ulozZabezpeceni(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="twoFactorPolicy">Povinné dvoufázové ověření</Label>
        <Select name="twoFactorPolicy" defaultValue={politika}>
          <SelectTrigger id="twoFactorPolicy" className="w-full sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLITIKY.map((polozka) => (
              <SelectItem key={polozka.id} value={polozka.id}>
                {polozka.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Kdo ho má povinné a nezapnul si ho, dostane se po přihlášení jen na Můj účet, dokud si ho
          nezapne. Platí to i pro tebe.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sessionHours">Jak dlouho platí přihlášení (hodin)</Label>
        <Input
          id="sessionHours"
          name="sessionHours"
          type="number"
          min={1}
          max={maxHodin}
          step={1}
          defaultValue={hodin}
          className="w-32"
        />
        <p className="text-muted-foreground text-xs leading-relaxed">
          1 až {maxHodin} hodin od přihlášení. Pak se musí přihlásit znovu. Zkrácení platí hned —
          kdo je přihlášený déle, bude odhlášen.
        </p>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit zabezpečení
      </Button>
    </form>
  );
}
