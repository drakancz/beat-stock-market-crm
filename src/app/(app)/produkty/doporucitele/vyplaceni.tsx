"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { oznacVyplaceni } from "./actions";

/** Odškrtnutí vyplacené odměny a jeho vrácení — jen administrátor (hlídá akce). */
export function Vyplaceni({
  odmenaId,
  vyplaceno,
  popis,
}: {
  odmenaId: string;
  vyplaceno: boolean;
  /** Pro čtečky obrazovky: komu a za co („Jan Novák, 2026-0012"). */
  popis: string;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const prepni = () =>
    zahaj(async () => {
      const vysledek = await oznacVyplaceni(odmenaId, !vyplaceno);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      router.refresh();
    });

  return vyplaceno ? (
    <Button variant="ghost" size="sm" onClick={prepni} disabled={ceka}>
      {ceka ? <Loader2 className="animate-spin" /> : <Undo2 />}
      Vrátit k výplatě<span className="sr-only">: {popis}</span>
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={prepni} disabled={ceka}>
      {ceka ? <Loader2 className="animate-spin" /> : <Check />}
      Vyplaceno<span className="sr-only">: {popis}</span>
    </Button>
  );
}
