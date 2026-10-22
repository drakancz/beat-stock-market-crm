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

import { zapniVlastniPravidlo } from "./vlastni-actions";

/**
 * Zapnutí vlastního pravidla se potvrzuje — řekne, kolika klientů se zítra
 * ráno týká (zprávy i úkoly odejdou všem najednou). Vypnutí je hned.
 */
export function ZapnutiPravidla({
  id,
  nazev,
  zapnuto,
  splnuje,
}: {
  id: string;
  nazev: string;
  zapnuto: boolean;
  splnuje: number;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  const proved = (zapnout: boolean) =>
    zahaj(async () => {
      const vysledek = await zapniVlastniPravidlo(id, zapnout);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      setOtevreno(false);
      router.refresh();
    });

  if (zapnuto) {
    return (
      <Button variant="outline" size="sm" disabled={ceka} onClick={() => proved(false)}>
        {ceka && <Loader2 className="animate-spin" />}
        Vypnout
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOtevreno(true)}>
        Zapnout
      </Button>
      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zapnout pravidlo</DialogTitle>
            <DialogDescription>
              Zapnout {nazev}? Při nejbližším ranním běhu se akce provedou u všech klientů, kteří
              podmínky splňují — teď je jich {splnuje}. Každému klientovi jednou.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button disabled={ceka} onClick={() => proved(true)}>
              {ceka && <Loader2 className="animate-spin" />}
              Zapnout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
