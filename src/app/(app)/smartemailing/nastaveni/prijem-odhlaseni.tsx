"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, PlugZap, Unplug } from "lucide-react";
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

import { vypniPrijemOdhlaseni, zapniPrijemOdhlaseni } from "./actions";

/**
 * Tlačítka pro příjem odhlášení ze SmartEmailingu (Jakub, 15. 9. 2026).
 * **Jen administrátor** — stránka i akce mají `requireAdmin()`.
 *
 * Vypnutí maže webhook ve SmartEmailingu, proto má potvrzovací okno
 * (CLAUDE.md, „Mazání se vždy potvrzuje").
 */
export function PrijemOdhlaseni({
  zapnuto,
  lzeZapnout,
  znovu,
}: {
  zapnuto: boolean;
  /** Je vyplněné heslo, přihlašovací údaje a veřejná adresa? */
  lzeZapnout: boolean;
  /** Webhook ve SmartEmailingu chybí nebo je vypnutý — nabídne se založit znovu. */
  znovu: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [potvrzeni, nastavPotvrzeni] = useState(false);

  const zapni = () =>
    zahaj(async () => {
      const vysledek = await zapniPrijemOdhlaseni();
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      router.refresh();
    });

  const vypni = () =>
    zahaj(async () => {
      const vysledek = await vypniPrijemOdhlaseni();
      if (!vysledek.ok) {
        // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      nastavPotvrzeni(false);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {(!zapnuto || znovu) && (
        <Button type="button" disabled={ceka || !lzeZapnout} onClick={zapni}>
          {ceka && !potvrzeni ? <Loader2 className="animate-spin" /> : <PlugZap />}
          {znovu ? "Zapnout příjem znovu" : "Zapnout příjem odhlášení"}
        </Button>
      )}

      {zapnuto && (
        <Button
          type="button"
          variant="outline"
          disabled={ceka}
          onClick={() => nastavPotvrzeni(true)}
        >
          <Unplug />
          Vypnout příjem odhlášení
        </Button>
      )}

      <Dialog open={potvrzeni} onOpenChange={(stav) => !stav && nastavPotvrzeni(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vypnout příjem odhlášení</DialogTitle>
            <DialogDescription>
              Ve SmartEmailingu se smaže webhook, kterým CRM dostává odhlášené kontakty.{" "}
              <strong>Tuhle akci nelze vzít zpět</strong> — příjem jde později zapnout jen jako nový
              webhook. Kdo se mezitím odhlásí, přijde v CRM o souhlas až po tlačítku Načíst
              odhlášené v Synchronizaci kontaktů.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => nastavPotvrzeni(false)}>
              Zrušit
            </Button>
            <Button variant="destructive" disabled={ceka} onClick={vypni}>
              {ceka && <Loader2 className="animate-spin" />}
              Vypnout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
