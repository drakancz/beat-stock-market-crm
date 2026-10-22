"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
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

import { vystavitDobropis, vystavitFakturu } from "./actions";

/**
 * Faktury u objednávky (19. 10. 2026): odkaz na PDF vidí každý přihlášený;
 * dobropis a ruční vystavení u starší objednávky jen administrátor (roli
 * hlídají akce). Dobropis se potvrzuje — doklad nejde vzít zpět.
 */
export function FakturyObjednavky({
  faktury,
  cislo,
  orderId,
  zaplaceno,
  jeAdmin,
}: {
  faktury: { id: string; number: string; kind: "FAKTURA" | "DOBROPIS" }[];
  cislo: string;
  orderId: string;
  zaplaceno: boolean;
  jeAdmin: boolean;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();
  const faktura = faktury.find((f) => f.kind === "FAKTURA");
  const dobropis = faktury.find((f) => f.kind === "DOBROPIS");

  const proved = (akce: () => ReturnType<typeof vystavitFakturu>) =>
    zahaj(async () => {
      const vysledek = await akce();
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      setOtevreno(false);
      router.refresh();
    });

  if (!faktura) {
    if (!jeAdmin || !zaplaceno) return null;
    return (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        disabled={ceka}
        onClick={() => proved(() => vystavitFakturu(orderId))}
      >
        Vystavit fakturu
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs">
      {[faktura, dobropis].filter(Boolean).map((doklad) => (
        <a
          key={doklad!.id}
          href={`/objednavky/faktura/${doklad!.id}`}
          className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          <FileText className="size-3" aria-hidden />
          {doklad!.number}
        </a>
      ))}
      {jeAdmin && !dobropis && (
        <>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setOtevreno(true)}
          >
            Dobropis
          </Button>
          <Dialog open={otevreno} onOpenChange={setOtevreno}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Vystavit dobropis</DialogTitle>
                <DialogDescription>
                  Vystavit k faktuře {faktura.number} (objednávka {cislo}) opravný daňový doklad na
                  celou částku? Stav objednávky ani platbu tím nezměníš — peníze přes bránu vrací
                  tlačítko Vrátit peníze. <strong>Tuhle akci nelze vzít zpět.</strong>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOtevreno(false)}>
                  Zrušit
                </Button>
                <Button
                  variant="destructive"
                  disabled={ceka}
                  onClick={() => proved(() => vystavitDobropis(faktura.id))}
                >
                  {ceka && <Loader2 className="animate-spin" />}
                  Vystavit dobropis
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </span>
  );
}
