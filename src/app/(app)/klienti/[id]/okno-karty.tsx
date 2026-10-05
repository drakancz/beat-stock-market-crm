"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Tlačítko na kartě klienta, které otevře okno s obsahem — Objednávky
 * a Poznámky (Jakub, 23. 9. 2026). Stejný tvar jako okno Přílohy.
 *
 * Obsah se vykresluje **na serveru** a sem se předává hotový, takže
 * se oprávnění počítají tam. Okno samo nic nepovoluje.
 *
 * Ikona chodí jako hotový prvek (`<ReceiptText />`), ne jako komponenta —
 * ze serveru do prohlížeče jde poslat jen to první.
 */
export function OknoKarty({
  tlacitko,
  ikona,
  nadpis,
  popis,
  children,
}: {
  tlacitko: string;
  ikona: ReactNode;
  nadpis: string;
  popis: string;
  children: ReactNode;
}) {
  const [otevreno, setOtevreno] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOtevreno(true)}>
        {ikona}
        {tlacitko}
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
              {ikona}
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
