"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SeznamOdberatelu } from "@/lib/smartemailing";

import { ulozSmartemailing, vyzkousejSpojeni } from "./actions";

export function FormularSmartemailingu({
  zapnuto,
  seznamId,
  nazevSeznamu,
  seznamy,
  seznamyNacteny,
  nastaveny,
}: {
  zapnuto: boolean;
  seznamId: number | null;
  nazevSeznamu: string | null;
  seznamy: SeznamOdberatelu[];
  /** Odpověděl SmartEmailing? Jen pak se dá říct, že uložený seznam zmizel. */
  seznamyNacteny: boolean;
  nastaveny: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  // Uložený seznam, který ve výpisu chybí (SmartEmailing neodpověděl nebo
  // seznam zrušili), se nabídne dál — jinak by se výběr tiše vyprázdnil.
  const nazevUlozeneho = nazevSeznamu ?? `Seznam č. ${seznamId}`;
  const volby =
    seznamId !== null && !seznamy.some((seznam) => seznam.id === seznamId)
      ? [
          {
            id: seznamId,
            name: seznamyNacteny ? `${nazevUlozeneho} (ve SmartEmailingu už není)` : nazevUlozeneho,
          },
          ...seznamy,
        ]
      : seznamy;

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozSmartemailing(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="smartemailingEnabled"
          name="smartemailingEnabled"
          defaultChecked={zapnuto}
          disabled={!nastaveny && !zapnuto}
          className="mt-0.5"
        />
        <Label htmlFor="smartemailingEnabled" className="text-sm leading-relaxed font-normal">
          Posílat nové klienty se souhlasem s marketingem do SmartEmailingu
        </Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="smartemailingListId">Seznam odběratelů</Label>
        <Select
          name="smartemailingListId"
          defaultValue={seznamId === null ? undefined : String(seznamId)}
          disabled={volby.length === 0}
        >
          <SelectTrigger id="smartemailingListId" className="w-full sm:w-96">
            <SelectValue placeholder="Vyber seznam" />
          </SelectTrigger>
          <SelectContent>
            {volby.map((seznam) => (
              <SelectItem key={seznam.id} value={String(seznam.id)}>
                {seznam.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Nabídka se načítá přímo ze SmartEmailingu. Nový seznam založ tam a tuhle stránku obnov.
        </p>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit
      </Button>
    </form>
  );
}

/** Ověří přihlašovací údaje z `.env`, aniž by cokoli odeslal. */
export function ZkouskaSpojeni() {
  const [ceka, zahaj] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={ceka}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await vyzkousejSpojeni();
          if (vysledek.ok) toast.success(vysledek.zprava);
          else toast.error(vysledek.chyba);
        })
      }
    >
      {ceka ? <Loader2 className="animate-spin" /> : <PlugZap />}
      Vyzkoušet spojení
    </Button>
  );
}
