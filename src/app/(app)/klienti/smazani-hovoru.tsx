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

import { smazHovor } from "./actions";

/**
 * Potvrzení smazání hovoru.
 *
 * **Každá mazací akce v systému má potvrzovací okno** (CLAUDE.md).
 *
 * Text schválně mluví o nenávratném smazání, i když se hovor ve
 * skutečnosti jen odloží do společného koše. Jakub to tak rozhodl
 * 6. 9. 2026: uživatel má mazat s vědomím, že je to napořád, aby si to
 * rozmyslel. Že to administrátor umí vrátit, je záchranná brzda,
 * ne nabídka — proto se tu slovo „koš" neobjeví.
 *
 * Okno je pohodlí, ne ochrana — nárok si serverová akce ověřuje sama.
 *
 * Používá se na kartě klienta i v přehledu Hovory, ať mazání vypadá
 * a chová se na obou místech stejně.
 */
export function SmazaniHovoru({ hovor }: { hovor: { id: string; popis: string } }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <Dialog open={otevreno} onOpenChange={setOtevreno}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOtevreno(true)}
        aria-label="Smazat hovor"
        title="Smazat hovor"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat hovor</DialogTitle>
          <DialogDescription>
            Opravdu smazat hovor {hovor.popis}? <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        <Alert className="my-2">
          <AlertDescription className="text-xs leading-relaxed">
            Hovor zmizí z časové osy klienta, ze záložky Hovory i z čísel na Dashboardu.
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
                const vysledek = await smazHovor(hovor.id);

                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
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
            Smazat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
