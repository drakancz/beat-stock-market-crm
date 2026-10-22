"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Stitek } from "@/components/stitky/stitek";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { POPIS_DRUHU_OSY } from "@/lib/casova-osa-druhy";
import type { NahledKlienta as Nahled } from "@/lib/nahled-klienta";

import { nactiNahled } from "./nahled-actions";

/**
 * Panel z boku s rychlým náhledem klienta (Fáze 5B, Jakub 18. 10. 2026).
 *
 * Jen čtení — měnit se dá na kartě, na kterou vede tlačítko dole. Data se
 * načtou až po otevření; šipky přejdou na předchozího a dalšího klienta
 * v pořadí seznamu, ať jde třeba filtr Nechodí projít jednoho po druhém.
 */

const POPIS_UCTU: Record<Nahled["klientskaCast"], string> = {
  zadny: "bez účtu",
  pozvan: "pozvánka odeslaná",
  aktivni: "aktivní účet",
  zrusen: "přístup zrušený",
};

export function NahledKlienta({
  poradi,
  otevreny,
  zavrit,
  otevrit,
}: {
  /** Id klientů v pořadí, jak jsou v seznamu. */
  poradi: { id: string; name: string }[];
  otevreny: string | null;
  zavrit: () => void;
  otevrit: (id: string) => void;
}) {
  const [nahledy, setNahledy] = useState<Record<string, Nahled | "chyba">>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!otevreny || nahledy[otevreny]) return;
    const id = otevreny;
    startTransition(async () => {
      const nahled = await nactiNahled(id);
      setNahledy((dosud) => ({ ...dosud, [id]: nahled ?? "chyba" }));
    });
  }, [otevreny, nahledy]);

  const index = otevreny ? poradi.findIndex((klient) => klient.id === otevreny) : -1;
  const predchozi = index > 0 ? poradi[index - 1] : null;
  const dalsi = index >= 0 && index < poradi.length - 1 ? poradi[index + 1] : null;
  const jmeno = index >= 0 ? poradi[index].name : "";
  const nahled = otevreny ? nahledy[otevreny] : undefined;

  return (
    <Sheet open={otevreny !== null} onOpenChange={(otevreno) => !otevreno && zavrit()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg font-semibold break-words">{jmeno}</SheetTitle>
          <SheetDescription>
            {index >= 0 && `Klient ${index + 1} z ${poradi.length} v seznamu`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {nahled === undefined ? (
            <p className="text-muted-foreground text-sm">Načítám…</p>
          ) : nahled === "chyba" ? (
            <p className="text-destructive text-sm">Klienta se nepodařilo načíst.</p>
          ) : (
            <ObsahNahledu nahled={nahled} />
          )}
        </div>

        <SheetFooter className="flex-row items-center gap-2 border-t">
          <Button
            variant="outline"
            size="icon"
            disabled={!predchozi}
            onClick={() => predchozi && otevrit(predchozi.id)}
            aria-label={predchozi ? `Předchozí klient: ${predchozi.name}` : "Předchozí klient"}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={!dalsi}
            onClick={() => dalsi && otevrit(dalsi.id)}
            aria-label={dalsi ? `Další klient: ${dalsi.name}` : "Další klient"}
          >
            <ChevronRight />
          </Button>
          {otevreny && (
            <Button asChild className="ml-auto">
              <Link href={`/klienti/${otevreny}`}>Otevřít kartu</Link>
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ObsahNahledu({ nahled }: { nahled: Nahled }) {
  return (
    <div className="space-y-5 text-sm">
      <dl className="space-y-1">
        <Radek popis="E-mail" hodnota={<span className="break-all">{nahled.email}</span>} />
        <Radek popis="Telefon" hodnota={nahled.telefon ?? "—"} />
        <Radek
          popis="Přístup do programu"
          hodnota={nahled.pristup === "POVOLEN" ? "Povolen" : "Nepovolen"}
        />
        <Radek
          popis="Souhlas s marketingem"
          hodnota={nahled.souhlasMarketing ? `ano, od ${nahled.souhlasMarketing}` : "ne"}
        />
      </dl>

      {nahled.stitky.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nahled.stitky.map((stitek) => (
            <Stitek key={stitek.id} nazev={stitek.name} barva={stitek.color} />
          ))}
        </div>
      )}

      <section className="space-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          Platnost
          {nahled.nechodi && (
            <Badge variant="outline" title="Platí členství, ale klientská část je dlouho bez návštěvy">
              Nechodí
            </Badge>
          )}
        </h3>
        {nahled.platnosti.length === 0 ? (
          <p className="text-muted-foreground">Žádný produkt s platností.</p>
        ) : (
          <ul className="space-y-0.5">
            {nahled.platnosti.map((platnost) => (
              <li key={platnost.produkt} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{platnost.produkt}</span>
                <span
                  className={
                    platnost.skoncilo
                      ? "text-muted-foreground tabular shrink-0"
                      : "tabular shrink-0"
                  }
                >
                  {platnost.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold">Klientská část</h3>
        <dl className="space-y-1">
          <Radek popis="Účet" hodnota={POPIS_UCTU[nahled.klientskaCast]} />
          <Radek popis="Naposledy" hodnota={nahled.naposledy ?? "zatím ne"} />
          <Radek popis="Aktivní týdny" hodnota={`${nahled.aktivnichTydnu} z posledních 12`} />
          <Radek popis="Lekce za 30 dní" hodnota={String(nahled.lekciZa30Dni)} />
          <Radek popis="Body" hodnota={nahled.body} />
        </dl>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold">Objednávky ({nahled.pocetObjednavek})</h3>
        {nahled.objednavky.length === 0 ? (
          <p className="text-muted-foreground">Zatím žádná.</p>
        ) : (
          <ul className="space-y-0.5">
            {nahled.objednavky.map((objednavka) => (
              <li key={objednavka.id} className="flex justify-between gap-3">
                <span className="tabular">{objednavka.cislo}</span>
                <span className="text-muted-foreground text-right">
                  {objednavka.stav} · {objednavka.kdy}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Poslední dění</h3>
        {nahled.udalosti.length === 0 ? (
          <p className="text-muted-foreground">Zatím tu nic není.</p>
        ) : (
          <ol className="space-y-2" aria-label="Poslední dění">
            {nahled.udalosti.map((udalost) => (
              <li key={udalost.id} className="min-w-0">
                <p className="text-muted-foreground text-xs">
                  {udalost.cas} · {POPIS_DRUHU_OSY[udalost.druh]}
                </p>
                <p className="break-words">{udalost.nadpis}</p>
                {udalost.popis && (
                  <p className="text-muted-foreground line-clamp-2 break-words">{udalost.popis}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Radek({ popis, hodnota }: { popis: string; hodnota: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{popis}</dt>
      <dd className="min-w-0 text-right">{hodnota}</dd>
    </div>
  );
}
