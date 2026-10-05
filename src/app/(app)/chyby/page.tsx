import { redirect } from "next/navigation";
import { z } from "zod";

import { precti, textParam } from "@/lib/parametry";
import { requireAdmin } from "@/lib/session";

/**
 * Stará adresa sekce Chyby. Od 15. 9. 2026 jsou Chyby záložkou sekce
 * SmartEmailing (`/smartemailing/chyby`, Jakub). Odkaz na starou adresu je
 * v už odeslaných e-mailech s upozorněním, proto přesměrování i s filtrem.
 *
 * Přesměrovává jen administrátora — ostatní dostanou 404 už z
 * `requireAdmin()`, takže se z přesměrování nedozví, že sekce existuje.
 */
export default async function StaraAdresaChyb({ searchParams }: PageProps<"/chyby">) {
  await requireAdmin();

  // Hodnoty jen přepošle; jestli dávají smysl, rozhodne cílová stránka.
  const vstup = precti(z.object({ stav: textParam(40), druh: textParam(40) }), await searchParams);
  const dotaz = new URLSearchParams();
  for (const klic of ["stav", "druh"] as const) {
    const hodnota = vstup[klic];
    if (hodnota) dotaz.set(klic, hodnota);
  }

  const text = dotaz.toString();
  redirect(text ? `/smartemailing/chyby?${text}` : "/smartemailing/chyby");
}
