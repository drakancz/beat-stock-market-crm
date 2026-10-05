"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Po kolika milisekundách se karta obnoví a kolikrát nejvýš. */
const INTERVAL_MS = 2_000;
const NEJVYS_POKUSU = 10;

/**
 * Hlídání výsledku odeslání do SmartEmailingu na kartě nového klienta.
 *
 * Klient odchází do SmartEmailingu až po uložení, takže karta, na kterou
 * formulář přesměruje, výsledek ještě nezná. Tahle komponenta ji každé
 * dvě sekundy obnoví, dokud výsledek nepřijde — pak ji server přestane
 * vykreslovat a obnovování skončí samo. Nejvýš ale dvacet sekund, ať
 * karta neobnovuje donekonečna (Jakub, 15. 9. 2026).
 *
 * Nic nezobrazuje a nic nechrání: co se na kartě ukáže, rozhoduje server.
 */
export function HlidaniSmartemailingu() {
  const router = useRouter();

  useEffect(() => {
    let pokusu = 0;
    const casovac = setInterval(() => {
      pokusu += 1;
      router.refresh();
      if (pokusu >= NEJVYS_POKUSU) clearInterval(casovac);
    }, INTERVAL_MS);

    return () => clearInterval(casovac);
  }, [router]);

  return null;
}
