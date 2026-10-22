"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Tlačítko s potvrzovacím oknem pro smazání termínu a zrušení rezervace
 * (CLAUDE.md → Mazání se vždy potvrzuje): co se ruší jménem, že to nejde
 * vzít zpět a kdy to server odmítne. Při odmítnutí okno zůstane otevřené.
 */
export function Potvrzeni({
  tlacitko,
  titulek,
  popis,
  potvrdit,
  zpet = "Zrušit",
  akce,
}: {
  tlacitko: string;
  titulek: string;
  popis: ReactNode;
  potvrdit: string;
  /** Tlačítko, které okno zavře beze změny. */
  zpet?: string;
  akce: () => Promise<{ ok: true; zprava: string } | { ok: false; chyba: string }>;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOtevreno(true)}>
        {tlacitko}
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titulek}</DialogTitle>
            <DialogDescription>{popis}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              {zpet}
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await akce();
                  if (!vysledek.ok) {
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              {potvrdit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
