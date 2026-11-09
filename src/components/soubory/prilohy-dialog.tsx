"use client";

import { useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Přílohy v okně — tlačítko vedle ostatních akcí záznamu.
 *
 * U klienta je vedle „Upravit" (Jakub, 21. 9. 2026),
 * ať se kvůli souborům nemusí přepínat záložka.
 *
 * Samotný seznam je `SekcePriloh`, která se vykresluje **na serveru**
 * a sem se předává jako obsah. Oprávnění se tedy počítají tam, stejně
 * jako všude jinde — tohle okno nic nepovoluje.
 */
export function PrilohyDialog({
  pocet,
  popis,
  children,
  nadpis = "Přílohy",
  tlacitko,
  maly = false,
}: {
  pocet: number;
  popis: string;
  children: ReactNode;
  /** Nadpis okna — u lekce „Materiály: název lekce“. */
  nadpis?: string;
  /** Text tlačítka bez počtu; výchozí je nadpis. */
  tlacitko?: string;
  /** Malé tlačítko do řádku (u lekce v detailu kurzu). */
  maly?: boolean;
}) {
  const [otevreno, setOtevreno] = useState(false);

  return (
    <>
      <Button
        variant={maly ? "ghost" : "outline"}
        size={maly ? "sm" : "default"}
        onClick={() => setOtevreno(true)}
      >
        <Paperclip />
        {tlacitko ?? nadpis} ({pocet})
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 break-words">
              <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
              {nadpis}
            </DialogTitle>
            <DialogDescription>{popis}</DialogDescription>
          </DialogHeader>

          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
