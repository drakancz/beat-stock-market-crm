"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Pošle do Aktivity každou otevřenou obrazovku.
 *
 * Nic nevykresluje. Posílá **jen adresu bez části za otazníkem** —
 * v hledání a filtrech bývají jména a telefony klientů. Co se smí zapsat,
 * rozhoduje server (`src/app/api/aktivita/route.ts`).
 *
 * `sendBeacon` je způsob, jakým se měří návštěvnost: prohlížeč záznam
 * odešle na pozadí, na odpověď se nečeká a nezdrží ani odchod ze stránky.
 */
export function ZaznamObrazovek() {
  const pathname = usePathname();
  // React ve vývoji spouští efekt dvakrát; stejná adresa se nezapíše podruhé.
  const posledni = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || posledni.current === pathname) return;
    posledni.current = pathname;

    const telo = JSON.stringify({ path: pathname });
    const odeslano = navigator.sendBeacon?.(
      "/api/aktivita",
      new Blob([telo], { type: "application/json" }),
    );

    if (!odeslano) {
      void fetch("/api/aktivita", {
        method: "POST",
        body: telo,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {
        // Záznam aktivity nesmí nikoho vyrušit hláškou.
      });
    }
  }, [pathname]);

  return null;
}
