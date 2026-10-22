"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { vyzkousej, zapniWebhook } from "./actions";

/** Zkušební zpráva a vypínač webhooku — jen administrátor (hlídá akce). */
export function TlacitkaWebhooku({
  id,
  nazev,
  zapnuty,
}: {
  id: string;
  nazev: string;
  zapnuty: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const proved = (akce: () => ReturnType<typeof vyzkousej>) =>
    zahaj(async () => {
      const vysledek = await akce();
      if (vysledek.ok) toast.success(vysledek.zprava);
      else toast.error(vysledek.chyba);
      router.refresh();
    });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={ceka}
        onClick={() => proved(() => vyzkousej(id))}
        aria-label={`Vyzkoušet webhook: ${nazev}`}
      >
        {ceka ? <Loader2 className="animate-spin" /> : <Send />}
        Vyzkoušet
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={ceka}
        onClick={() => proved(() => zapniWebhook(id, !zapnuty))}
      >
        {zapnuty ? "Vypnout" : "Zapnout"}
      </Button>
    </>
  );
}
