"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { upravPoznamkuHovoru } from "../klienti/actions";

/**
 * Poznámka u hovoru, přepsatelná rovnou v tabulce.
 *
 * Zobrazená podoba je text; kliknutím na tužku se z něj stane pole.
 * Vlastní obrazovka na jednu větu by byla zbytečná okliku navíc.
 *
 * **Že se tužka nezobrazí, není ochrana** — nárok si serverová akce
 * ověřuje sama, takže poznámku u cizího hovoru nepřepíše ani ten, kdo
 * si požadavek pošle mimo rozhraní.
 */
export function Poznamka({
  hovorId,
  poznamka,
  smiMenit,
}: {
  hovorId: string;
  poznamka: string;
  smiMenit: boolean;
}) {
  const router = useRouter();
  const [upravuje, setUpravuje] = useState(false);
  const [text, setText] = useState(poznamka);
  const [ceka, zahaj] = useTransition();

  if (!smiMenit) {
    return poznamka ? (
      <span className="text-sm whitespace-pre-line">{poznamka}</span>
    ) : (
      <span className="text-muted-foreground text-sm">—</span>
    );
  }

  if (!upravuje) {
    return (
      <span className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 text-sm whitespace-pre-line">
          {poznamka || <span className="text-muted-foreground">Bez poznámky</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label="Upravit poznámku"
          onClick={() => {
            setText(poznamka);
            setUpravuje(true);
          }}
        >
          <Pencil />
        </Button>
      </span>
    );
  }

  function uloz() {
    zahaj(async () => {
      const vysledek = await upravPoznamkuHovoru(hovorId, text);

      if (!vysledek.ok) {
        // Pole zůstane otevřené i s napsaným textem — ať se nepřepisuje znovu.
        toast.error(vysledek.chyba);
        return;
      }

      toast.success(vysledek.zprava);
      setUpravuje(false);
      router.refresh();
    });
  }

  return (
    <span className="flex flex-col gap-1.5">
      <Textarea
        value={text}
        onChange={(udalost) => setText(udalost.target.value)}
        rows={3}
        maxLength={5000}
        autoFocus
        placeholder="Co se na hovoru domluvilo."
        aria-label="Poznámka k hovoru"
      />
      <span className="flex gap-1.5">
        <Button size="sm" onClick={uloz} disabled={ceka}>
          {ceka ? <Loader2 className="animate-spin" /> : <Check />}
          Uložit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setUpravuje(false)} disabled={ceka}>
          <X />
          Zrušit
        </Button>
      </span>
    </span>
  );
}
