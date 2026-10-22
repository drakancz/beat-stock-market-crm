"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DRUHY_OSY, POPIS_DRUHU_OSY, type DruhOsy, type UdalostOsy } from "@/lib/casova-osa-druhy";

import { nactiOsuKlienta } from "../casova-osa-actions";

/**
 * Obsah okna Časová osa na kartě klienta (Fáze 5B, Jakub 16. 10. 2026).
 *
 * Události se načítají až po otevření okna (obsah okna se vykreslí až
 * tehdy), takže karta kvůli ose nezpomalí. Přepínač Změny dostane jen
 * administrátor — server ten druh ostatním stejně nevydá.
 */
export function CasovaOsa({ klientId, jeAdmin }: { klientId: string; jeAdmin: boolean }) {
  const [druh, setDruh] = useState<DruhOsy | null>(null);
  const [udalosti, setUdalosti] = useState<UdalostOsy[] | null>(null);
  const [starsi, setStarsi] = useState<string | null>(null);
  const [chyba, setChyba] = useState(false);
  const [nacitam, startTransition] = useTransition();

  function nacti(novyDruh: DruhOsy | null, pred: string | null) {
    startTransition(async () => {
      const vysledek = await nactiOsuKlienta(klientId, novyDruh, pred);
      if (!vysledek.ok) {
        setChyba(true);
        return;
      }
      setChyba(false);
      setUdalosti((dosud) =>
        pred && dosud ? [...dosud, ...vysledek.udalosti] : vysledek.udalosti,
      );
      setStarsi(vysledek.starsi);
    });
  }

  useEffect(() => {
    nacti(null, null);
    // Jen při otevření okna; filtr načítá sám přes `prepni()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prepni(novyDruh: DruhOsy | null) {
    setDruh(novyDruh);
    nacti(novyDruh, null);
  }

  const druhy = DRUHY_OSY.filter((moznost) => moznost !== "zmeny" || jeAdmin);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Druh událostí">
        <Button
          size="sm"
          variant={druh === null ? "default" : "outline"}
          aria-pressed={druh === null}
          onClick={() => prepni(null)}
        >
          Vše
        </Button>
        {druhy.map((moznost) => (
          <Button
            key={moznost}
            size="sm"
            variant={druh === moznost ? "default" : "outline"}
            aria-pressed={druh === moznost}
            onClick={() => prepni(moznost)}
          >
            {POPIS_DRUHU_OSY[moznost]}
          </Button>
        ))}
      </div>

      {chyba ? (
        <p className="text-destructive text-sm">Časovou osu se nepodařilo načíst.</p>
      ) : udalosti === null ? (
        <p className="text-muted-foreground text-sm">Načítám…</p>
      ) : udalosti.length === 0 ? (
        <p className="text-muted-foreground text-sm">Zatím tu nic není.</p>
      ) : (
        <ol className="border-border space-y-4 border-l pl-4" aria-label="Časová osa klienta">
          {udalosti.map((udalost) => (
            <li key={udalost.id} className="relative min-w-0">
              <span
                aria-hidden
                className="bg-primary absolute top-1.5 -left-[21px] size-2.5 rounded-full"
              />
              <p className="text-muted-foreground text-xs">
                {udalost.cas} · {POPIS_DRUHU_OSY[udalost.druh]}
                {udalost.kdo && ` · ${udalost.kdo}`}
              </p>
              <p className="text-sm font-medium break-words">{udalost.nadpis}</p>
              {udalost.popis && (
                <p className="text-muted-foreground text-sm break-words">{udalost.popis}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {starsi && !chyba && (
        <Button variant="outline" size="sm" disabled={nacitam} onClick={() => nacti(druh, starsi)}>
          {nacitam ? "Načítám…" : "Načíst starší"}
        </Button>
      )}
    </div>
  );
}
