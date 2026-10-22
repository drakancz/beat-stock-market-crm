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

import { dejObjednavkuDoKose } from "./actions";

/**
 * Smazání objednávky.
 *
 * Smí ho každý, kdo na objednávku vidí — obchodník u svých klientů,
 * manažer a administrátor u všech. Okno je pohodlí, ne ochrana: rozsah
 * si serverová akce ověřuje sama.
 *
 * Text mluví o nenávratném smazání, i když se záznam ve skutečnosti jen
 * odloží do Smazaných. Jakub to tak rozhodl 6. 9. 2026 — kdo maže, má to
 * dělat s vědomím, že je to napořád.
 */
export function SmazaniObjednavky({
  objednavka,
  velikost,
  /** Po smazání odejít jinam — používá se tam, kde po objednávce zůstane prázdná stránka. */
  poSmazani,
}: {
  objednavka: { id: string; number: string; clientName: string; zaplaceno: boolean };
  velikost?: "sm" | "icon";
  poSmazani?: string;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        variant="outline"
        size={velikost}
        aria-label={`Smazat objednávku ${objednavka.number}`}
        onClick={() => setOtevreno(true)}
      >
        <Trash2 />
        {velikost === "icon" ? null : "Smazat"}
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Smazat objednávku</DialogTitle>
            <DialogDescription>
              Opravdu smazat objednávku <strong>{objednavka.number}</strong> u klienta{" "}
              {objednavka.clientName}? Zmizí ze seznamu i z karty klienta.{" "}
              <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>

          <Alert variant={objednavka.zaplaceno ? "destructive" : "default"} className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              {objednavka.zaplaceno
                ? "Tahle objednávka je zaplacená. Smazáním zmizí i z tržeb v Cílech na Dashboardu — klientovi ale zaplacené peníze nikdo nevrátí."
                : "Smaže se i seznam objednaných produktů. Klient se tím nemění."}
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
                  const vysledek = await dejObjednavkuDoKose(objednavka.id);

                  if (!vysledek.ok) {
                    // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                    toast.error(vysledek.chyba);
                    return;
                  }

                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  if (poSmazani) router.push(poSmazani);
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
