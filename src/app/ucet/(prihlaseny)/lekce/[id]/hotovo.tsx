"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { oznacLekci } from "../../kurzy/actions";

/** Tlačítko Hotovo / Vrátit u lekce. */
export function HotovoLekce({ lekceId, hotovo }: { lekceId: string; hotovo: boolean }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <Button
      variant={hotovo ? "outline" : "default"}
      disabled={ceka}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await oznacLekci(lekceId, !hotovo);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          router.refresh();
        })
      }
    >
      {ceka ? <Loader2 className="animate-spin" /> : hotovo ? <CheckCircle2 /> : <Circle />}
      {hotovo ? "Hotovo — vrátit" : "Označit jako hotovou"}
    </Button>
  );
}
