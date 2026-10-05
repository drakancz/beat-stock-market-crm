"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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
 * Tlačítko Smazat s potvrzovacím oknem pro obsah vzdělávání — kurz,
 * lekci, článek, webinář (krok 3C). **Každé mazání má potvrzovací okno**
 * (CLAUDE.md): co se maže jménem, že to nejde vzít zpět, a co se stane
 * navíc. Při odmítnutí okno zůstane otevřené.
 */
export function SmazaniObsahu({
  titulek,
  nazev,
  dusledky,
  smazat,
  poSmazani,
  maly,
}: {
  /** Nadpis okna, třeba „Smazat kurz". */
  titulek: string;
  nazev: string;
  /** Co se stane navíc („Klienti ho přestanou vidět…"). */
  dusledky: string;
  smazat: () => Promise<{ ok: true; zprava: string } | { ok: false; chyba: string }>;
  /** Kam po smazání — jinak jen obnovit stránku. */
  poSmazani?: string;
  maly?: boolean;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        variant={maly ? "ghost" : "outline"}
        size={maly ? "icon" : "default"}
        title={titulek}
        onClick={() => setOtevreno(true)}
      >
        <Trash2 />
        <span className={maly ? "sr-only" : undefined}>
          {maly ? `${titulek}: ${nazev}` : "Smazat"}
        </span>
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titulek}</DialogTitle>
            <DialogDescription>
              Opravdu smazat {nazev}? {dusledky} <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await smazat();
                  if (!vysledek.ok) {
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  if (poSmazani) router.push(poSmazani);
                  else router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Smazat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
