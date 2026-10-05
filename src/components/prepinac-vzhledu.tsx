"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

const VOLBY = [
  { hodnota: "light", popis: "Světlý", Ikona: Sun },
  { hodnota: "dark", popis: "Tmavý", Ikona: Moon },
  { hodnota: "system", popis: "Podle systému", Ikona: Monitor },
] as const;

/*
 * Výběr světlého a tmavého vzhledu v menu u jména (Jakub, 22. 9. 2026).
 *
 * Vidí ho **každý přihlášený** a mění jím jen svoje vlastní zobrazení —
 * na data ani na oprávnění to nemá žádný vliv, proto tu není kontrola
 * role. Volba se pamatuje v prohlížeči, ne v databázi.
 */
export function PrepinacVzhledu() {
  const { theme, setTheme } = useTheme();

  /*
   * Obvyklá pojistka „počkej, až se to připojí k prohlížeči" tady není
   * potřeba: celá tahle nabídka je uvnitř menu, které se vykreslí až po
   * otevření. Při prvním načtení stránky tedy neexistuje a není co
   * porovnávat se serverem.
   */
  const vybrana = theme ?? "system";
  const Aktivni = VOLBY.find((volba) => volba.hodnota === vybrana)?.Ikona ?? Monitor;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Aktivni />
        Vzhled
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={vybrana} onValueChange={setTheme}>
          {VOLBY.map(({ hodnota, popis, Ikona }) => (
            <DropdownMenuRadioItem key={hodnota} value={hodnota}>
              <Ikona />
              {popis}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
