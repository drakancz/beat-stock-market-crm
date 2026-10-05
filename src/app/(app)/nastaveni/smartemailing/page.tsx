import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/session";

/**
 * Stará adresa nastavení SmartEmailingu. Od 13. 9. 2026 je SmartEmailing
 * vlastní položka hlavního menu (Jakub). Přesměrovává jen administrátora —
 * ostatní dostanou 404 už z `requireAdmin()` (i z rámu Nastavení), takže se
 * z přesměrování nedozví, že sekce existuje.
 */
export default async function StaraAdresaSmartemailingu() {
  await requireAdmin();
  redirect("/smartemailing/nastaveni");
}
