import type { Metadata } from "next";
import { Percent } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nactiSazbyDph } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";

import { SazbyDph } from "./sazby-dph";

export const metadata: Metadata = { title: "Nastavení" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Sazby DPH.
 *
 * **Vidí i mění jen administrátor** (Jakub, 10. 9. 2026). Sazby jsou
 * vždycky tři; mění se jejich název a výše, nepřidávají se ani nemažou.
 */
export default async function NastaveniPage() {
  await requireAdmin();
  const sazby = await nactiSazbyDph();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Sazby DPH
          </CardTitle>
          <CardDescription>
            Tři sazby, ze kterých se vybírá u každého produktu. Ceny se v ceníku zadávají bez DPH a
            cena s DPH se dopočítá podle sazby produktu. Po změně výše se ceny s DPH přepočítají
            samy; částky bez DPH, a tedy ani statistiky, se nezmění.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SazbyDph
            sazby={sazby.map((sazba) => ({
              id: sazba.id,
              name: sazba.name,
              rate: sazba.rate,
              produktu: sazba.produktu,
            }))}
          />
        </CardContent>
      </Card>

      <PoznamkaPodCarou>
        Každá změna sazby se zapíše do auditního logu i s původní hodnotou a objeví se v Aktivitě.
        Se sazbou se u produktu počítá jen cena pro klienta — objednávky, Dashboard i ostatní čísla
        v systému jsou vždycky bez DPH.
      </PoznamkaPodCarou>
    </>
  );
}
