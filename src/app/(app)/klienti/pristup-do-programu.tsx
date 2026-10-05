"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROGRAM_ACCESSES, PROGRAM_ACCESS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProgramAccess } from "@/generated/prisma/enums";

import { zmenPristupKlienta } from "./pristup-actions";

/**
 * Přístup do programu — výběr pro administrátora, jinak jen popisek.
 *
 * **Od 23. 9. 2026 je jeden za klienta** a stojí ve sloupci seznamu
 * klientů (Jakub); do té doby byl u každé objednávky v sekci Objednávky.
 *
 * Zatím je to **jen evidence**: žádný systém se podle toho neotevírá,
 * poskytování produktu bude samostatný projekt. Tým si tu odškrtává,
 * komu přístup zařídil.
 *
 * Klient, který zaplatil a přístup nemá, se zvýrazní — je to nedodělaná
 * práce, ne běžný stav.
 */
export function PristupDoProgramu({
  klient,
  smiMenit,
}: {
  klient: { id: string; name: string; programAccess: ProgramAccess; zaplatil: boolean };
  smiMenit: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  /*
   * Barva podle stavu (Jakub, 23. 9. 2026): povolen světle zelená,
   * nepovolen světle červená — u každého klienta, nejen u toho, kdo
   * zaplatil. Vlastní odstíny `pristup-ano` / `pristup-ne`, ne zisk
   * a ztráta (globals.css). Stav je napsaný i slovem, barva není jediné
   * vodítko.
   */
  const barva =
    klient.programAccess === "POVOLEN"
      ? "border-pristup-ano-foreground/25 bg-pristup-ano text-pristup-ano-foreground dark:bg-pristup-ano hover:bg-pristup-ano/80 dark:hover:bg-pristup-ano/80"
      : "border-pristup-ne-foreground/25 bg-pristup-ne text-pristup-ne-foreground dark:bg-pristup-ne hover:bg-pristup-ne/80 dark:hover:bg-pristup-ne/80";
  // `dark:` je nutné: výběr má v tmavém režimu vlastní podklad (`dark:bg-input/30`),
  // který by jinak barvu stavu přebil.

  if (!smiMenit) {
    return (
      <Badge variant="outline" className={barva}>
        {PROGRAM_ACCESS_LABEL[klient.programAccess]}
      </Badge>
    );
  }

  return (
    // `name` jen kvůli skrytému poli, které Select vloží do stránky —
    // bez něj prohlížeč hlásí pole bez názvu (26. 9. 2026). Nic se neodesílá.
    <Select
      name={`pristup-${klient.id}`}
      value={klient.programAccess}
      disabled={ceka}
      onValueChange={(pristup) =>
        zahaj(async () => {
          const vysledek = await zmenPristupKlienta(klient.id, pristup);

          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }

          toast.success(vysledek.zprava);
          router.refresh();
        })
      }
    >
      <SelectTrigger
        size="sm"
        className={cn("w-28", barva, "[&_svg]:text-current [&_svg]:opacity-70")}
        aria-label={`Přístup do programu: ${klient.name}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROGRAM_ACCESSES.map((pristup) => (
          <SelectItem key={pristup.id} value={pristup.id}>
            {pristup.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
