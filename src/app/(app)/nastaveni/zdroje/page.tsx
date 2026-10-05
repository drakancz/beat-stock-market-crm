import type { Metadata } from "next";
import { Megaphone } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nactiZdrojeKlientu } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";

import { SpravaZdroju } from "./sprava-zdroju";

export const metadata: Metadata = { title: "Zdroje klientů" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Zdroje klientů.
 *
 * **Vidí i mění jen administrátor** (Jakub, 10. 9. 2026). U klienta se
 * zdroj jen vybírá — obchodník nový nezaloží, ať se seznam nerozroste
 * o „FB", „Facebook" a „facebook reklama".
 */
export default async function ZdrojePage() {
  await requireAdmin();
  const zdroje = await nactiZdrojeKlientu();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Zdroje klientů
          </CardTitle>
          <CardDescription>
            Odkud se o nás klienti dozvěděli. U klienta se zdroj vybírá z tohoto seznamu, takže jde
            na Dashboardu sečíst. Zdroj se nemaže: skrytý se u nových klientů nenabízí, dva podobné
            sloučíš do jednoho.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpravaZdroju zdroje={zdroje} />
        </CardContent>
      </Card>

      <PoznamkaPodCarou>
        Dosavadní ručně psané zdroje se 10. 9. 2026 převedly do seznamu tak, jak byly napsané. Kdyby
        se v něm objevily dvě podoby téhož, sluč je. Každá změna jde do auditního logu.
      </PoznamkaPodCarou>
    </>
  );
}
