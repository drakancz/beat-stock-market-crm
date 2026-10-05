"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDatum } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { cn } from "@/lib/utils";

export interface Pripominka {
  id: string;
  title: string;
  dueAt: Date;
  poTerminu: boolean;
  clientId: string;
  clientName: string;
}

/**
 * Zvoneček s připomínkami úkolů v horní liště (Jakub, 26. 9. 2026).
 *
 * Na každé obrazovce ukazuje, kolik vlastních úkolů je na dnes nebo po
 * termínu; když je něco po termínu, číslo je červené. Klik rozbalí
 * seznam s odkazem na klienta a do Mého dne. Úkoly načítá rám aplikace
 * (`nactiPripominky()`), jen vlastní — obsah hlídá dotaz na serveru.
 *
 * Po odškrtnutí, úpravě nebo smazání úkolu akce volají `router.refresh()`
 * a s ním se obnoví i rám, takže číslo sedí bez načtení stránky znovu.
 */
export function Pripominky({ ukoly }: { ukoly: Pripominka[] }) {
  const [otevreno, setOtevreno] = useState(false);
  const poTerminu = ukoly.filter((ukol) => ukol.poTerminu).length;
  const popisek =
    ukoly.length === 0
      ? "Připomínky úkolů: nic nezbývá"
      : `Připomínky úkolů: ${pocet(ukoly.length, "úkol", "úkoly", "úkolů")}` +
        (poTerminu > 0 ? `, ${poTerminu} po termínu` : "");

  return (
    <Popover open={otevreno} onOpenChange={setOtevreno}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative shrink-0" aria-label={popisek}>
          <Bell />
          {ukoly.length > 0 && (
            <span
              aria-hidden
              data-slot="pripominky-pocet"
              className={cn(
                "tabular absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold",
                poTerminu > 0 ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
              )}
            >
              {ukoly.length > 99 ? "99+" : ukoly.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Připomínky úkolů</p>
          <p className="text-muted-foreground text-xs">Tvoje úkoly na dnes a po termínu.</p>
        </div>

        {ukoly.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-4 text-sm">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Na dnes nic nezbývá.
          </p>
        ) : (
          <ul
            aria-label="Úkoly na dnes a po termínu"
            className="divide-border max-h-80 divide-y overflow-y-auto"
          >
            {ukoly.map((ukol) => (
              <li key={ukol.id} className="px-4 py-2.5">
                <p className="text-sm font-medium break-words">{ukol.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  <Link
                    href={`/klienti/${ukol.clientId}`}
                    className="hover:text-foreground underline-offset-4 hover:underline"
                    onClick={() => setOtevreno(false)}
                  >
                    {ukol.clientName}
                  </Link>
                  {" · "}
                  {ukol.poTerminu ? (
                    <span className="text-destructive font-medium">
                      po termínu od {formatDatum(ukol.dueAt)}
                    </span>
                  ) : (
                    "dnes"
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t px-4 py-2.5">
          <Link
            href="/dashboard"
            className="text-sm font-medium underline-offset-4 hover:underline"
            onClick={() => setOtevreno(false)}
          >
            Všechny úkoly v Mém dni
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
