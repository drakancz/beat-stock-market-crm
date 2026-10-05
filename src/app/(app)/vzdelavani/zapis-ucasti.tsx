"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { PoleVyberu, type Polozka } from "@/components/pole-vyberu";
import { Button } from "@/components/ui/button";

import { zapisUcast } from "./webinare-actions";

/**
 * Zápis účasti klienta na webináři — jen administrátor (roli hlídá
 * `zapisUcast()`). Klient se hledá i bez diakritiky.
 */
export function ZapisUcasti({ webinarId, klienti }: { webinarId: string; klienti: Polozka[] }) {
  const router = useRouter();
  const [klic, setKlic] = useState(0);
  const [ceka, zahaj] = useTransition();

  return (
    <form
      key={klic}
      action={(formData) =>
        zahaj(async () => {
          const vysledek = await zapisUcast(formData);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          setKlic((k) => k + 1);
          router.refresh();
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="webinarId" value={webinarId} />
      <div className="min-w-56 flex-1">
        <PoleVyberu
          name="clientId"
          polozky={klienti}
          prazdna={{ hodnota: "", popisek: "Vyber klienta" }}
          popisekTlacitka="Vyber klienta"
          placeholderHledani="Hledat klienta…"
          prazdnyVysledek="Žádný klient tomu neodpovídá."
        />
      </div>
      <Button type="submit" disabled={ceka}>
        {ceka ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Zapsat účast
      </Button>
    </form>
  );
}
