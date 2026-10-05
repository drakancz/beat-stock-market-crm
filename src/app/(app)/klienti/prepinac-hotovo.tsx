"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";

import { prepniHotovoUkolu } from "./ukoly-actions";

/**
 * Odškrtnutí úkolu.
 *
 * Do 22. 9. 2026 bylo políčko u úkolu jen nakreslené — kliknutí se nikam
 * neuložilo. Tohle je jeho obsah.
 *
 * **Přepne se okamžitě, ještě než odpoví server** (`useOptimistic`).
 * Bez toho políčko po kliknutí chvíli drží starý stav a vypadá to, že
 * se nic nestalo — u odškrtávání seznamu je to hodně znát. Když akce
 * selže, React vrátí zobrazení na skutečný stav z databáze sám.
 *
 * Používá se na Dashboardu i na kartě klienta, ať se to na obou místech
 * chová stejně. **Kdo smí odškrtnout, řeší serverová akce** (majitel
 * a administrátor); tady se políčko neskrývá — kdyby se skrývalo, nebylo
 * by z rozhraní poznat, že úkol vůbec existuje.
 */
export function PrepinacHotovo({ ukol }: { ukol: { id: string; title: string; hotovo: boolean } }) {
  const router = useRouter();
  const [, zahaj] = useTransition();
  const [hotovo, nastavHned] = useOptimistic(ukol.hotovo);

  return (
    <Checkbox
      id={ukol.id}
      checked={hotovo}
      aria-label={
        hotovo
          ? `Vrátit úkol ${ukol.title} mezi čekající`
          : `Označit úkol ${ukol.title} jako hotový`
      }
      className="mt-0.5"
      onCheckedChange={(stav) =>
        zahaj(async () => {
          // Radix umí i „neurčitý" stav; do akce musí jít pravda nebo lež.
          const chce = stav === true;
          nastavHned(chce);

          const vysledek = await prepniHotovoUkolu(ukol.id, chce);

          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
          }

          // Načte skutečný stav z databáze — po chybě tím políčko skočí zpět.
          router.refresh();
        })
      }
    />
  );
}
