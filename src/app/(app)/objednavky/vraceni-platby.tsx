"use client";

import { useState, useTransition } from "react";
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

import { vratitPenize } from "./actions";

/**
 * Vrácení peněz za platbu přes bránu — jen administrátor (roli hlídá akce).
 * Potvrzovací okno: co se vrací, že to nejde vzít zpět a co se stane
 * s objednávkou.
 */
export function VraceniPlatby({ paymentId, cislo }: { paymentId: string; cislo: string }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={() => setOtevreno(true)}
      >
        Vrátit peníze
      </Button>
      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vrátit peníze</DialogTitle>
            <DialogDescription>
              Vrátit klientovi celou platbu za objednávku {cislo} přes GoPay? Objednávka se přepne
              na Nezaplaceno a s ní se zruší i platnost členství a odměna doporučiteli (pokud není
              vyplacená). K faktuře se vystaví dobropis.{" "}
              <strong>Tuhle akci nelze vzít zpět.</strong>
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
                  const vysledek = await vratitPenize(paymentId);
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
              Vrátit peníze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
