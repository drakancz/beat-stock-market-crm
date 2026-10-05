"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { uzavritChybu, znovuSpustitChybu, type Vysledek } from "./actions";

/**
 * Akce u nevyřešené chyby: Znovu spustit a Uzavřít. Co se smí, rozhoduje
 * server (`requireAdmin()` v akcích) — tlačítka nic nechrání.
 */
export function TlacitkaChyby({
  id,
  jdeZnovuSpustit,
  popis,
}: {
  id: string;
  /** Odmítnutý lead z webu zopakovat nejde. */
  jdeZnovuSpustit: boolean;
  /** Pro čtečky obrazovky — čeho se tlačítko týká. */
  popis: string;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const spust = (akce: (id: string) => Promise<Vysledek>) =>
    zahaj(async () => {
      const vysledek = await akce(id);
      if (vysledek.ok) toast.success(vysledek.zprava);
      else toast.error(vysledek.chyba);
      router.refresh();
    });

  return (
    <div className="flex justify-end gap-2">
      {jdeZnovuSpustit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={ceka}
          aria-label={`Znovu spustit: ${popis}`}
          onClick={() => spust(znovuSpustitChybu)}
        >
          {ceka ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Znovu spustit
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={ceka}
        aria-label={`Uzavřít: ${popis}`}
        onClick={() => spust(uzavritChybu)}
      >
        <CheckCheck />
        Uzavřít
      </Button>
    </div>
  );
}
