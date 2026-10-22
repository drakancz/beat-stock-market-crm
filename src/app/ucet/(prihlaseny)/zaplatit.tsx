"use client";

import { useTransition } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { zaplatitObjednavku } from "./actions";

/** Tlačítko Zaplatit u nezaplacené objednávky — přejde na platební bránu. */
export function Zaplatit({ orderId, cislo }: { orderId: string; cislo: string }) {
  const [ceka, zahaj] = useTransition();

  return (
    <Button
      size="sm"
      disabled={ceka}
      aria-label={`Zaplatit objednávku ${cislo}`}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await zaplatitObjednavku(orderId);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          window.location.assign(vysledek.adresa);
        })
      }
    >
      {ceka ? <Loader2 className="animate-spin" /> : <CreditCard />}
      Zaplatit
    </Button>
  );
}
