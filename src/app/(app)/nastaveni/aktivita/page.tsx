import type { Metadata } from "next";
import Link from "next/link";
import { CalendarX2, History, SearchX, UsersRound } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Strankovani } from "@/components/strankovani";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DRUHY_AKTIVITY,
  PRESTAVKA_MINUT,
  nactiSeznamAktivity,
  nactiSouhrnAktivity,
  prectiFiltrAktivity,
  type DruhZaznamu,
  type FiltrAktivity,
} from "@/lib/aktivita";
import { formatDate, formatDatumCas, formatMinuty } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

import { VyberObdobi } from "../../dashboard/vyber-obdobi";

export const metadata: Metadata = { title: "Aktivita" };

export const dynamic = "force-dynamic";

/** Jak se druh záznamu ukazuje v seznamu. */
const ZNACKA: Record<
  DruhZaznamu,
  { label: string; varianta: "outline" | "secondary" | "destructive" }
> = {
  prihlaseni: { label: "Přihlášení", varianta: "outline" },
  neuspesne: { label: "Neúspěch", varianta: "destructive" },
  obrazovka: { label: "Obrazovka", varianta: "outline" },
  mcp: { label: "AI (MCP)", varianta: "secondary" },
  zmena: { label: "Změna", varianta: "secondary" },
};

/** Adresa s filtry — pro odkazy na člověka, druh i stránku. Období se drží. */
function adresa(
  filtr: FiltrAktivity,
  zmena: { uzivatel?: string | null; druh?: string | null; stranka?: number },
): string {
  const dotaz = new URLSearchParams();
  dotaz.set("obdobi", filtr.obdobi.id);
  if (filtr.obdobi.id === "vlastni") {
    dotaz.set("od", filtr.obdobi.prvniDen);
    dotaz.set("do", filtr.obdobi.posledniDen);
  }

  const uzivatel = zmena.uzivatel === undefined ? filtr.uzivatelId : zmena.uzivatel;
  const druh = zmena.druh === undefined ? filtr.druh : zmena.druh;
  if (uzivatel) dotaz.set("uzivatel", uzivatel);
  if (druh) dotaz.set("druh", druh);
  if (zmena.stranka && zmena.stranka > 1) dotaz.set("stranka", String(zmena.stranka));

  return `/nastaveni/aktivita?${dotaz.toString()}`;
}

/** Přepínač filtru — obyčejný odkaz, volba žije v adrese. */
function Volba({
  href,
  vybrana,
  children,
}: {
  href: string;
  vybrana: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      asChild
      size="sm"
      variant={vybrana ? "default" : "outline"}
      className={cn(!vybrana && "text-muted-foreground")}
    >
      <Link href={href} aria-current={vybrana ? "page" : undefined}>
        {children}
      </Link>
    </Button>
  );
}

/**
 * Nastavení → Aktivita: co kdo v systému dělal.
 *
 * **Vidí jen administrátor** (Jakub, 10. 9. 2026) — zábrana je v rámu
 * sekce i tady. Obrazovka jen čte; záznamy nejde upravit ani smazat.
 *
 * Skládá se ze tří zdrojů: přihlášení a otevřené obrazovky
 * (`user_events`), změny z auditního logu a hovory. Záznam je po
 * obrazovkách, ne po kliknutích (Jakub, 10. 9. 2026).
 */
export default async function AktivitaPage({ searchParams }: PageProps<"/nastaveni/aktivita">) {
  await requireAdmin();

  const parametry = await searchParams;
  const filtr = prectiFiltrAktivity(parametry);

  const [souhrn, seznam] = await Promise.all([
    nactiSouhrnAktivity(filtr.obdobi),
    nactiSeznamAktivity(filtr),
  ]);

  const vybrany = souhrn.find((clovek) => clovek.id === filtr.uzivatelId);

  return (
    <>
      <VyberObdobi
        obdobi={filtr.obdobi}
        cesta="/nastaveni/aktivita"
        zachovat={{ uzivatel: filtr.uzivatelId, druh: filtr.druh }}
      />

      {filtr.obdobi.odmitnutyRozsah && (
        <Alert variant="destructive">
          <CalendarX2 />
          <AlertTitle>Zadaný rozsah nešel použít</AlertTitle>
          <AlertDescription>
            Datum v adrese neexistuje v kalendáři, je obrácené, nebo je delší než pět let. Ukazuje
            se místo něj výchozích 30 dní.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Kdo kolik v systému dělal
          </CardTitle>
          <CardDescription>
            Za {filtr.obdobi.label} — {formatDate(filtr.obdobi.prvniDen)} až{" "}
            {formatDate(filtr.obdobi.posledniDen)}. Kliknutím na jméno se seznam níž omezí na toho
            člověka.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="-mx-2 overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Člověk</TableHead>
                  <TableHead>Poslední přihlášení</TableHead>
                  <TableHead className="text-right">Čas v aplikaci</TableHead>
                  <TableHead className="text-right">Obrazovky</TableHead>
                  <TableHead className="text-right">Změny</TableHead>
                  <TableHead className="text-right">Hovory</TableHead>
                  <TableHead className="text-right">Neúspěšná přihlášení</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {souhrn.map((clovek) => (
                  <TableRow
                    key={clovek.id}
                    className={cn(clovek.id === filtr.uzivatelId && "bg-muted/60")}
                  >
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link
                        href={adresa(filtr, { uzivatel: clovek.id, stranka: 1 })}
                        className="underline-offset-4 hover:underline"
                      >
                        {clovek.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {ROLE_LABEL[clovek.role]}
                        {clovek.smazany && " · smazaný účet"}
                      </span>
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      {clovek.posledniPrihlaseni ? (
                        formatDatumCas(clovek.posledniPrihlaseni)
                      ) : (
                        <span className="text-muted-foreground">zatím nikdy</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">
                      {clovek.sezeni > 0 ? (
                        <>
                          {formatMinuty(clovek.minutVAplikaci)}
                          <span className="text-muted-foreground block text-xs">
                            {pocet(clovek.sezeni, "sezení", "sezení", "sezení")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{clovek.obrazovek}</TableCell>
                    <TableCell className="tabular text-right">{clovek.zmen}</TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">
                      {clovek.hovoru}
                      {clovek.hovoru > 0 && (
                        <span className="text-muted-foreground block text-xs">
                          celkem {formatMinuty(clovek.minutHovoru)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {clovek.neuspesnych > 0 ? (
                        <Badge variant="destructive">{clovek.neuspesnych}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Záznamy {vybrany ? `— ${vybrany.name}` : "celého týmu"}
          </CardTitle>
          <CardDescription>
            Od nejnovějšího. {pocet(seznam.celkem, "záznam", "záznamy", "záznamů")} v období.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Druh záznamu">
              <Volba href={adresa(filtr, { druh: null, stranka: 1 })} vybrana={!filtr.druh}>
                Vše
              </Volba>
              {DRUHY_AKTIVITY.map((druh) => (
                <Volba
                  key={druh.id}
                  href={adresa(filtr, { druh: druh.id, stranka: 1 })}
                  vybrana={filtr.druh === druh.id}
                >
                  {druh.label}
                </Volba>
              ))}
            </div>
            {filtr.uzivatelId && (
              <div className="flex flex-wrap gap-1.5">
                <Volba href={adresa(filtr, { uzivatel: null, stranka: 1 })} vybrana={false}>
                  Zobrazit celý tým
                </Volba>
              </div>
            )}
          </div>

          {seznam.zaznamy.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nic tu není."
              description="V tomhle období a s těmito filtry se nic nezapsalo. Zkus delší období nebo jiný druh."
            />
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Kdy</TableHead>
                    <TableHead>Kdo</TableHead>
                    <TableHead>Druh</TableHead>
                    <TableHead className="min-w-[16rem]">Co</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seznam.zaznamy.map((zaznam) => (
                    <TableRow key={`${zaznam.druh}-${zaznam.id}`}>
                      <TableCell className="tabular whitespace-nowrap">
                        {formatDatumCas(zaznam.at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{zaznam.kdo}</TableCell>
                      <TableCell>
                        <Badge variant={ZNACKA[zaznam.druh].varianta}>
                          {ZNACKA[zaznam.druh].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {zaznam.odkaz ? (
                          <Link href={zaznam.odkaz} className="underline-offset-4 hover:underline">
                            {zaznam.titulek}
                          </Link>
                        ) : (
                          zaznam.titulek
                        )}
                        {zaznam.popis && (
                          <span className="text-muted-foreground block text-xs">
                            {zaznam.popis}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Strankovani
            stranka={filtr.stranka}
            stranek={seznam.stranek}
            celkem={seznam.celkem}
            adresa={(stranka) => adresa(filtr, { stranka })}
          />
        </CardContent>
      </Card>

      <PoznamkaPodCarou>
        Aktivitu vidí jen administrátor a nejde upravit ani smazat. Zapisuje se přihlášení a
        odhlášení, neúspěšné pokusy o přihlášení k existujícím účtům, každá otevřená obrazovka a
        všechny změny z auditního logu. Kliknutí ani obsah formulářů se nezapisují.{" "}
        <strong>Čas v aplikaci je odhad</strong>: sčítá se doba od prvního do posledního kroku
        každého sezení a přestávka delší než {PRESTAVKA_MINUT} minut sezení ukončí. Délka hovorů je
        součet délek zapsaných u hovorů. Aktivita se zaznamenává od 10. 9. 2026; o záznamu je dobré
        tým informovat.
      </PoznamkaPodCarou>
    </>
  );
}
