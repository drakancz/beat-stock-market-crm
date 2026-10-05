"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { posunLekci } from "./kurzy-actions";

/** Šipky pro změnu pořadí lekce (jen administrátor — roli hlídá akce). */
export function PosunLekce({
  id,
  nazev,
  prvni,
  posledni,
}: {
  id: string;
  nazev: string;
  prvni: boolean;
  posledni: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  function posun(smer: "nahoru" | "dolu") {
    zahaj(async () => {
      const vysledek = await posunLekci(id, smer);
      if (!vysledek.ok) toast.error(vysledek.chyba);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Posunout nahoru"
        disabled={ceka || prvni}
        onClick={() => posun("nahoru")}
      >
        <ArrowUp />
        <span className="sr-only">Posunout nahoru: {nazev}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Posunout dolů"
        disabled={ceka || posledni}
        onClick={() => posun("dolu")}
      >
        <ArrowDown />
        <span className="sr-only">Posunout dolů: {nazev}</span>
      </Button>
    </>
  );
}
