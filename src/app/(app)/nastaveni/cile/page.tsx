import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { z } from "zod";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TVAR_MESICE,
  nactiCileProNastaveni,
  popisMesice,
  posunMesic,
  tentoMesic,
} from "@/lib/cile";
import { parametr, precti } from "@/lib/parametry";
import { requireAdmin } from "@/lib/session";

import { FormularCilu } from "./formular";

export const metadata: Metadata = { title: "Cíle" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Cíle tržeb.
 *
 * **Nastavuje jen administrátor; plnění na Dashboardu vidí obchodník jen
 * svoje, manažer a administrátor všechno** (Jakub, 10. 9. 2026). Měsíc
 * je v adrese (`?mesic=2026-09`); co nesedí, spadne na tento měsíc.
 */
export default async function CilePage({ searchParams }: PageProps<"/nastaveni/cile">) {
  await requireAdmin();

  const { mesic: zadany } = precti(
    z.object({ mesic: parametr(z.string().regex(TVAR_MESICE), undefined) }),
    await searchParams,
  );
  const mesic = zadany ?? tentoMesic();

  const radky = await nactiCileProNastaveni(mesic);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Cíle tržeb bez DPH
          </CardTitle>
          <CardDescription>
            Tržby jsou obchodní případy uzavřené v daném měsíci. Cíl platí i do dalších měsíců,
            dokud ho nezměníš; prázdné políčko znamená bez cíle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/nastaveni/cile?mesic=${posunMesic(mesic, -1)}`}>
                <ChevronLeft />
                <span className="sr-only sm:not-sr-only">{popisMesice(posunMesic(mesic, -1))}</span>
              </Link>
            </Button>
            <span className="min-w-[9rem] text-center font-medium capitalize">
              {popisMesice(mesic)}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href={`/nastaveni/cile?mesic=${posunMesic(mesic, 1)}`}>
                <span className="sr-only sm:not-sr-only">{popisMesice(posunMesic(mesic, 1))}</span>
                <ChevronRight />
              </Link>
            </Button>
          </div>

          {/* `key` podle měsíce — po přepnutí se políčka naplní znovu. */}
          <FormularCilu
            key={mesic}
            mesic={mesic}
            radky={radky.map((radek) => ({
              userId: radek.userId,
              name: radek.name,
              castka: radek.castka,
              zdedenoZ:
                radek.odMesice && radek.odMesice !== mesic ? popisMesice(radek.odMesice) : null,
            }))}
          />
        </CardContent>
      </Card>

      <PoznamkaPodCarou>
        Plnění cíle se ukazuje na Dashboardu za aktuální měsíc — cíl je jeden za celou firmu a
        počítá se ze zaplacených objednávek bez DPH. Každá změna cíle jde do auditního logu.
      </PoznamkaPodCarou>
    </>
  );
}
