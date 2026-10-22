"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDatumCas } from "@/lib/format";
import { pocet } from "@/lib/mnozne";

import { obnovZaznam, smazZaznamNadobro } from "./actions";
import type { Druh } from "./druhy";

export interface RadekKose {
  druh: Druh;
  id: string;
  nazev: string;
  /** Druhý řádek pod názvem — e-mail, částka, počet objednávek. */
  popis: string;
  /** Kdy se do koše dostal, v ISO tvaru. */
  smazano: string;
  /** Zůstalo po něm něco? Podle toho jde smazat nadobro. */
  maHistorii: boolean;
  /** Proč trvalé smazání nejde. Ukáže se jako popisek u vypnutého tlačítka. */
  procNejde: string;
}

/**
 * Jak se každý druh záznamu pojmenuje.
 *
 * Sekce se řadí v tomhle pořadí — od toho, co je nejcennější vrátit,
 * k tomu, co je nejspíš překlep při zakládání.
 */
const DRUHY_POPIS: Record<
  Druh,
  { nadpis: string; sloupec: string; popis: string; jednotne: string; prazdno: string }
> = {
  klient: {
    nadpis: "Klienti",
    sloupec: "Klient",
    popis: "Obnovením se klient vrátí do seznamu i do statistik, včetně své historie.",
    jednotne: "klienta",
    prazdno: "Žádný smazaný klient.",
  },
  objednavka: {
    nadpis: "Objednávky",
    sloupec: "Objednávka",
    popis: "Obnovením se objednávka vrátí do seznamu i na kartu klienta, ve stavu, ve kterém byla.",
    jednotne: "objednávku",
    prazdno: "Žádná smazaná objednávka.",
  },
  produkt: {
    nadpis: "Produkty",
    sloupec: "Produkt",
    popis:
      "Obnovením se produkt vrátí do ceníku, do nabídky i do příjmu objednávek z Landing Page. Objednávky ho ukazují i ve Smazaných.",
    jednotne: "produkt",
    prazdno: "Žádný smazaný produkt.",
  },
  "slevovy-kod": {
    nadpis: "Slevové kódy",
    sloupec: "Kód",
    popis:
      "Obnovením se kód vrátí do Produkty → Slevové kódy a Landing Page ho zase přijme. Objednávky si slevu nechávají i bez něj.",
    jednotne: "kód",
    prazdno: "Žádný smazaný slevový kód.",
  },
  doporucitel: {
    nadpis: "Doporučitelé",
    sloupec: "Doporučitel",
    popis:
      "Obnovením se doporučitel vrátí do Produkty → Doporučitelé i s přivedenými klienty a odměnami.",
    jednotne: "doporučitele",
    prazdno: "Žádný smazaný doporučitel.",
  },
  broker: {
    nadpis: "Brokeři",
    sloupec: "Broker",
    popis: "Obnovením se broker vrátí do seznamu brokerů.",
    jednotne: "brokera",
    prazdno: "Žádný smazaný broker.",
  },
  uzivatel: {
    nadpis: "Uživatelé",
    sloupec: "Uživatel",
    popis: "Obnovením se účet vrátí do týmu. Odebraný přístup mu ale zůstane odebraný.",
    jednotne: "účet",
    prazdno: "Žádný smazaný účet.",
  },
};

/** V jakém pořadí sekce jdou za sebou. */
const PORADI: Druh[] = [
  "klient",
  "objednavka",
  "produkt",
  "slevovy-kod",
  "doporucitel",
  "broker",
  "uzivatel",
];

/**
 * Obsah společného koše, rozdělený podle druhu záznamu.
 *
 * Každý druh má vlastní tabulku s vlastním nadpisem — v jednom seznamu
 * se klient, objednávka a účet pletly dohromady a nešlo je od sebe na
 * první pohled odlišit. Karta se ukazuje i u prázdného druhu (Jakub,
 * 10. 9. 2026), ať je vidět, co všechno se sem dá vrátit.
 *
 * Trvalé smazání se ptá dvakrát: první kliknutí otevře okno, teprve
 * potvrzení v něm záznam odstraní. Je to jediné místo v systému, odkud
 * se dá něco odstranit nenávratně.
 */
export function SeznamSmazanych({ radky }: { radky: RadekKose[] }) {
  const router = useRouter();
  const [smazatNadobro, setSmazatNadobro] = useState<RadekKose | null>(null);
  const [obnovovany, setObnovovany] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  const klic = (radek: RadekKose) => `${radek.druh}:${radek.id}`;

  const skupiny = PORADI.map((druh) => ({
    druh,
    ...DRUHY_POPIS[druh],
    radky: radky.filter((radek) => radek.druh === druh),
  }));

  return (
    <>
      <div className="space-y-5">
        {skupiny.map((skupina) => (
          <Card key={skupina.druh}>
            <CardHeader>
              <CardTitle>{skupina.nadpis}</CardTitle>
              <CardDescription>{skupina.popis}</CardDescription>
              <CardAction>
                <span className="text-muted-foreground tabular text-sm">
                  {pocet(skupina.radky.length, "záznam", "záznamy", "záznamů")}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              {skupina.radky.length === 0 ? (
                <p className="text-muted-foreground text-sm">{skupina.prazdno}</p>
              ) : (
                <div className="-mx-2 overflow-x-auto px-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{skupina.sloupec}</TableHead>
                        <TableHead>Smazáno</TableHead>
                        <TableHead className="text-right">Akce</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skupina.radky.map((radek) => (
                        <TableRow key={klic(radek)}>
                          <TableCell>
                            <span className="font-medium whitespace-nowrap">{radek.nazev}</span>
                            <span className="text-muted-foreground block text-xs">
                              {radek.popis}
                            </span>
                          </TableCell>
                          <TableCell className="tabular text-muted-foreground whitespace-nowrap">
                            {formatDatumCas(new Date(radek.smazano))}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={ceka && obnovovany === klic(radek)}
                              title={`Vrátit ${skupina.jednotne} zpět`}
                              onClick={() =>
                                zahaj(async () => {
                                  setObnovovany(klic(radek));
                                  const vysledek = await obnovZaznam(radek.druh, radek.id);

                                  if (!vysledek.ok) {
                                    toast.error(vysledek.chyba);
                                    return;
                                  }

                                  toast.success(vysledek.zprava);
                                  router.refresh();
                                })
                              }
                            >
                              {ceka && obnovovany === klic(radek) ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <RotateCcw />
                              )}
                              Obnovit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSmazatNadobro(radek)}
                              // Nadobro jde smazat jen záznam, po kterém nic
                              // nezůstalo. Tlačítko to říká dopředu; kontrola
                              // je stejně na serveru.
                              disabled={radek.maHistorii}
                              title={radek.procNejde || "Trvale smazat"}
                            >
                              <Trash2 />
                              Trvale smazat
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={smazatNadobro !== null}
        onOpenChange={(stav) => !stav && setSmazatNadobro(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opravdu smazat nenávratně?</DialogTitle>
            <DialogDescription>
              {smazatNadobro
                ? `${DRUHY_POPIS[smazatNadobro.druh].sloupec} ${smazatNadobro.nazev} zmizí ze systému úplně.`
                : ""}{" "}
              <strong>Tohle už se nedá vzít zpět</strong> — na rozdíl od smazání, po kterém záznam
              zůstane tady.
            </DialogDescription>
          </DialogHeader>

          <Alert className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              Nenávratně jde odstranit jen záznam,{" "}
              <strong>po kterém v systému nic nezůstalo</strong>. Kdyby se na něj cokoli odkazovalo,
              zmizelo by z historie, ke komu to patřilo.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSmazatNadobro(null)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                smazatNadobro &&
                zahaj(async () => {
                  const vysledek = await smazZaznamNadobro(smazatNadobro.druh, smazatNadobro.id);

                  if (!vysledek.ok) {
                    toast.error(vysledek.chyba);
                    return;
                  }

                  toast.success(vysledek.zprava);
                  setSmazatNadobro(null);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Ano, smazat nenávratně
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
