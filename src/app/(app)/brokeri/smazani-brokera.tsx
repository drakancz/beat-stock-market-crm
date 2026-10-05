"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
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

import { pocet } from "@/lib/mnozne";

import { dejBrokeraDoKose } from "./actions";

/**
 * Potvrzení smazání brokera.
 *
 * **Každá mazací akce v systému má potvrzovací okno** (CLAUDE.md).
 *
 * Text schválně mluví o nenávratném smazání, i když se záznam ve
 * skutečnosti jen odloží do společného koše. Jakub to tak rozhodl
 * 6. 9. 2026: uživatel má mazat s vědomím, že je to napořád, aby si to
 * rozmyslel. Že to administrátor umí vrátit, je záchranná brzda,
 * ne nabídka.
 *
 * Je to vlastní komponenta, protože stejné potvrzení používá seznam
 * i detail brokera.
 */
export function DoKoseDialog({
  broker,
  zavrit,
  hotovo,
}: {
  broker: { id: string; name: string; pocetPortfolii: number } | null;
  zavrit: () => void;
  hotovo: () => void;
}) {
  const [ceka, zahaj] = useTransition();

  const portfolii = broker?.pocetPortfolii ?? 0;

  return (
    <Dialog open={broker !== null} onOpenChange={(stav) => !stav && zavrit()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat brokera</DialogTitle>
          <DialogDescription>
            Opravdu smazat {broker?.name}? Zmizí ze seznamu i z výběru u portfolií.{" "}
            <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        {portfolii > 0 && (
          <Alert className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              Pozor: portfolio u něj má{" "}
              <strong>{pocet(portfolii, "klient", "klienti", "klientů")}</strong>. Portfolia
              zůstanou i s údajem, u koho klient investuje — broker se jen přestane nabízet u
              nových.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={zavrit}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() =>
              broker &&
              zahaj(async () => {
                const vysledek = await dejBrokeraDoKose(broker.id);

                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                  toast.error(vysledek.chyba);
                  return;
                }

                toast.success(vysledek.zprava);
                hotovo();
              })
            }
          >
            {ceka && <Loader2 className="animate-spin" />}
            Smazat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
