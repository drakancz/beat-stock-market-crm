import type { Metadata } from "next";
import { CalendarDays, CalendarOff, Flag } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { nactiNastaveni } from "@/lib/nastaveni";
import { dnesVPraze, jakoDen } from "@/lib/obdobi";
import { requireAdmin } from "@/lib/session";
import { DNY_V_TYDNU, denVTydnu, svatkyRoku } from "@/lib/svatky";

import { FormularDnu, NoveVolno, ZruseniVolna } from "./formulare";

export const metadata: Metadata = { title: "Pracovní dny" };

export const dynamic = "force-dynamic";

/** `2026-12-24` → `čtvrtek 24. 12. 2026`. */
function sDnem(datum: string) {
  const den = DNY_V_TYDNU.find((polozka) => polozka.cislo === denVTydnu(datum))?.nazev ?? "";
  return `${den} ${formatDate(datum)}`;
}

/**
 * Nastavení → Pracovní dny.
 *
 * **Vidí i mění jen administrátor** (Jakub, 10. 9. 2026). Zatím je
 * používá Dnešek; až vzniknou úkoly, budou podle nich posouvat termíny.
 */
export default async function PracovniDnyPage() {
  await requireAdmin();

  const { rok } = dnesVPraze();
  const dnes = jakoDen(new Date());

  const [nastaveni, volna] = await Promise.all([
    nactiNastaveni(),
    db.companyDayOff.findMany({
      where: { deletedAt: null, date: { gte: new Date(`${rok}-01-01T00:00:00Z`) } },
      orderBy: { date: "asc" },
      select: { id: true, name: true, date: true },
    }),
  ]);

  const svatky = [...svatkyRoku(rok), ...svatkyRoku(rok + 1)];

  return (
    <>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
              Pracovní dny v týdnu
            </CardTitle>
            <CardDescription>
              Ve dny, které tu nejsou zaškrtnuté, upozorní Dashboard, že není pracovní den.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularDnu dny={nastaveni.workDays} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="text-muted-foreground size-4 shrink-0" aria-hidden />
              Volno firmy
            </CardTitle>
            <CardDescription>
              Dny navíc ke státním svátkům — firemní dovolená, teambuilding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NoveVolno />
            {volna.length === 0 ? (
              <p className="text-muted-foreground text-sm">Letos zatím žádné volno navíc.</p>
            ) : (
              <ul className="divide-border divide-y border-t">
                {volna.map((volno) => {
                  const datum = volno.date.toISOString().slice(0, 10);
                  return (
                    <li key={volno.id} className="flex items-center gap-3 py-2">
                      <span className="tabular text-muted-foreground w-44 shrink-0 text-sm">
                        {sDnem(datum)}
                      </span>
                      <span className="flex-1 text-sm font-medium">
                        {volno.name}
                        {datum < dnes && (
                          <span className="text-muted-foreground font-normal"> · proběhlo</span>
                        )}
                      </span>
                      <ZruseniVolna
                        volno={{ id: volno.id, name: volno.name, datum: formatDate(datum) }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Státní svátky {rok} a {rok + 1}
          </CardTitle>
          <CardDescription>
            Počítají se samy podle zákona, včetně Velikonoc. Nic tu není potřeba zadávat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-x-8 gap-y-1.5 text-sm md:grid-cols-2">
            {svatky.map((svatek) => (
              <li
                key={svatek.datum}
                className={svatek.datum < dnes ? "text-muted-foreground" : undefined}
              >
                <span className="tabular inline-block w-44">{sDnem(svatek.datum)}</span>
                {svatek.nazev}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
