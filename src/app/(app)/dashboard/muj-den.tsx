import Link from "next/link";
import { CalendarOff, CheckCircle2, ListChecks } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDatum } from "@/lib/format";
import type { dnesniVolno } from "@/lib/nastaveni";
import { dnesniZacatek } from "@/lib/platnost";
import type { nactiMojeUkoly } from "@/lib/queries";

import { PrepinacHotovo } from "../klienti/prepinac-hotovo";
import { SmazaniUkolu } from "../klienti/smazani-ukolu";
import { UkolDialog } from "../klienti/ukol-dialog";

type Volno = Awaited<ReturnType<typeof dnesniVolno>>;
type Ukoly = Awaited<ReturnType<typeof nactiMojeUkoly>>;

/**
 * Horní blok Dashboardu: co mě dnes čeká.
 *
 * Vznikl 22. 9. 2026 zrušením obrazovky Dnešek — dvě přistávací obrazovky,
 * obě s pozdravem a čtyřmi čísly, si konkurovaly a tým by nevěděl, kterou
 * ráno otevřít.
 *
 * **Stojí nad volbou období schválně.** Čísla níž se řídí přepínačem
 * (7 dní, minulý měsíc, letos), tenhle blok ne — úkol po termínu musí být
 * vidět vždycky. Je to druhá taková výjimka na téhle obrazovce, první je
 * Plnění cílů, proto je to u obou napsané přímo v popisku.
 *
 * Z Dneška se **nepřenášely** poslední hovory (Dashboard má o hovorech dva
 * grafy a v menu je celá sekce Hovory) ani čtyři dlaždice (Dashboard má
 * svoje vlastní).
 *
 * **Od 23. 9. 2026 se tu úkoly i zakládají, upravují a mažou** (Jakub) —
 * záložka Úkoly na kartě klienta zmizela. Oprávnění se nemění: zakládá
 * každý sobě, administrátor i kolegovi; mění majitel a administrátor.
 * Hlídá to `ukoly-actions.ts`, tlačítka nic nechrání.
 */
export function MujDen({
  ukoly,
  volno,
  klienti,
  majitele,
}: {
  ukoly: Ukoly;
  volno: Volno;
  /** Klienti k výběru u nového úkolu. */
  klienti: { id: string; name: string }[];
  /** Komu jde úkol zadat. Prázdné = jen sobě (běžný uživatel). */
  majitele: { id: string; name: string }[];
}) {
  // Porovnává se se skutečným dneškem, ne s datem v kódu — a s pražským.
  // Do 26. 9. 2026 tu bylo `setHours(0, 0, 0, 0)` v pásmu serveru (UTC),
  // a protože termín 26. 9. je v databázi 25. 9. 22:00 UTC, svítil
  // dnešní úkol jako „Po termínu".
  const dnes = dnesniZacatek();

  return (
    <div className="flex flex-col gap-4">
      {/* Svátky se počítají samy, volno a pracovní dny jsou v Nastavení. */}
      {volno && (
        <Alert>
          <CalendarOff />
          <AlertTitle>
            {volno.duvod === "svatek"
              ? `Dnes je státní svátek — ${volno.nazev}`
              : volno.duvod === "volno"
                ? `Dnes má firma volno — ${volno.nazev}`
                : "Dnes není pracovní den"}
          </AlertTitle>
          <AlertDescription>
            Systém funguje normálně, jen s tím počítej u termínů s klienty.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Moje úkoly
          </CardTitle>
          <CardDescription>
            Volba období níž se jich netýká — ukazují se všechny nehotové, nejbližší termín první.
          </CardDescription>
          <CardAction>
            <UkolDialog klienti={klienti} majitele={majitele} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {ukoly.length === 0 ? (
            /*
             * Tady schválně **není** `EmptyState` jako jinde v aplikaci.
             * Ten je vysoký skoro 200 px a tenhle blok stojí úplně nahoře
             * na přistávací obrazovce — komu nic nezbývá, odsunulo by mu to
             * všechna čísla pod okraj. Jeden řádek stačí.
             */
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              Nic nezbývá — žádný nehotový úkol.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {ukoly.map((ukol) => {
                const poTerminu = ukol.dueAt < dnes;

                return (
                  <li key={ukol.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <PrepinacHotovo ukol={{ id: ukol.id, title: ukol.title, hotovo: false }} />
                    <label htmlFor={ukol.id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-sm font-medium">{ukol.title}</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        <Link href={`/klienti/${ukol.clientId}`} className="hover:underline">
                          {ukol.clientName}
                        </Link>{" "}
                        · do {formatDatum(ukol.dueAt)}
                        {/* Založila ho AI přes MCP (Jakub, 5. 10. 2026). */}
                        {ukol.createdViaMcp && " · přes AI"}
                      </span>
                    </label>
                    {poTerminu ? (
                      <Badge variant="outline" className="shrink-0">
                        Po termínu
                      </Badge>
                    ) : null}
                    {/* Vlastní úkoly — Můj den ukazuje jen úkoly přihlášeného. */}
                    <UkolDialog
                      majitele={majitele}
                      ukol={{ id: ukol.id, title: ukol.title, dueAt: ukol.dueAt }}
                    />
                    <SmazaniUkolu ukol={{ id: ukol.id, title: ukol.title }} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
