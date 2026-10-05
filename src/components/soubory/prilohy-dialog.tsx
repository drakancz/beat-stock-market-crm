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
 * U klienta je mezi „Zapsat hovor" a „Upravit" (Jakub, 21. 9. 2026),
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
}: {
  pocet: number;
  popis: string;
  children: ReactNode;
}) {
  const [otevreno, setOtevreno] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOtevreno(true)}>
        <Paperclip />
        Přílohy ({pocet})
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
              Přílohy
            </DialogTitle>
            <DialogDescription>{popis}</DialogDescription>
          </DialogHeader>

          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
