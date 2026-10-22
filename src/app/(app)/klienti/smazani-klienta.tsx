"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { dejKlientaDoKose } from "./actions";

/**
 * Smazání klienta — jen pro administrátora.
 *
 * Klient nese souhlasy, objednávky i historii, takže to není rutina pro
 * obchodníka; kdo tlačítko nevidí, tomu by ho serverová akce stejně
 * odmítla.
 *
 * Text mluví o nenávratném smazání, i když se záznam ve skutečnosti jen
 * odloží do společného koše. Jakub to tak rozhodl 6. 9. 2026 — kdo maže
 * klienta, má to dělat s vědomím, že je to napořád.
 */
export function SmazaniKlienta({ klient }: { klient: { id: string; name: string } }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant="outline" onClick={() => setOtevreno(true)}>
        <Trash2 />
        Smazat
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Smazat klienta</DialogTitle>
            <DialogDescription>
              Opravdu smazat {klient.name}? Zmizí ze seznamu klientů i ze statistik.{" "}
              <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>

          <Alert className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              Zmizí i jeho úkoly. Pokud si jen nepřejete, aby ho někdo kontaktoval, změňte mu radši
              stav na <strong>Neaktivní</strong>.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await dejKlientaDoKose(klient.id);

                  if (!vysledek.ok) {
                    // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                    toast.error(vysledek.chyba);
                    return;
                  }

                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  // Karta smazaného klienta už neexistuje, takže zpátky na seznam.
                  router.push("/klienti");
                  router.refresh();
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
