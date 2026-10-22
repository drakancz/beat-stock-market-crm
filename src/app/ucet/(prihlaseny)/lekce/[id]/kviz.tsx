"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KvizKlienta } from "@/lib/vzdelavani/kvizy";

import { odesliKviz, type VysledekOdeslaniKvizu } from "../../kurzy/actions";

/**
 * Kvíz pod lekcí (Fáze 5C, 11. 10. 2026). Otázky přicházejí **bez
 * správných odpovědí**; hodnotí server a vrátí jen, které otázky byly
 * špatně. Klientům se vyká.
 */
export function KvizLekce({
  lekceId,
  kurzId,
  kviz,
  prah,
}: {
  lekceId: string;
  kurzId: string;
  kviz: KvizKlienta;
  prah: number;
}) {
  const router = useRouter();
  const [odpovedi, setOdpovedi] = useState<(number | null)[]>(() => kviz.otazky.map(() => null));
  const [vysledek, setVysledek] = useState<Extract<VysledekOdeslaniKvizu, { ok: true }> | null>(
    null,
  );
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  const spatne = new Set(vysledek?.spatne ?? []);
  const vse = odpovedi.every((odpoved) => odpoved !== null);

  return (
    <Card aria-labelledby={`kviz-${lekceId}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle id={`kviz-${lekceId}`} role="heading" aria-level={2}>
            Kvíz k lekci
          </CardTitle>
          <CardDescription>
            Ke splnění je potřeba aspoň {prah} % správných odpovědí. Zkoušet můžete, kolikrát
            chcete.
          </CardDescription>
        </div>
        {kviz.nejlepsi &&
          (kviz.nejlepsi.splneno ? (
            <Badge>
              <CheckCircle2 />
              Splněno {kviz.nejlepsi.spravne}/{kviz.nejlepsi.celkem}
            </Badge>
          ) : (
            <Badge variant="outline">
              Zatím nesplněno — nejlépe {kviz.nejlepsi.spravne}/{kviz.nejlepsi.celkem}
            </Badge>
          ))}
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(udalost) => {
            udalost.preventDefault();
            if (!vse) {
              setChyba("Odpovězte prosím na všechny otázky.");
              return;
            }
            zahaj(async () => {
              setChyba(null);
              const odpoved = await odesliKviz(lekceId, odpovedi as number[]);
              if (!odpoved.ok) {
                setChyba(odpoved.chyba);
                return;
              }
              setVysledek(odpoved);
              router.refresh();
            });
          }}
          className="space-y-6"
        >
          <ol className="space-y-5">
            {kviz.otazky.map((otazka, poradi) => (
              <li key={poradi}>
                <fieldset disabled={vysledek !== null} className="min-w-0 space-y-2">
                  <legend className="font-medium">
                    <span className="text-muted-foreground mr-1.5 font-mono">{poradi + 1}.</span>{" "}
                    {otazka.otazka}
                  </legend>
                  {otazka.moznosti.map((moznost, cislo) => (
                    <label
                      key={cislo}
                      className="hover:bg-muted/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm break-words"
                    >
                      <input
                        type="radio"
                        name={`otazka-${poradi}`}
                        value={cislo}
                        checked={odpovedi[poradi] === cislo}
                        onChange={() =>
                          setOdpovedi((pred) => pred.map((p, i) => (i === poradi ? cislo : p)))
                        }
                        className="accent-primary mt-0.5 size-4 shrink-0"
                      />
                      <span className="min-w-0">{moznost}</span>
                    </label>
                  ))}
                  {vysledek &&
                    (spatne.has(poradi) ? (
                      <p className="text-destructive flex items-center gap-1.5 text-sm">
                        <XCircle className="size-4" />
                        Tahle odpověď nebyla správná.
                      </p>
                    ) : (
                      <p className="text-primary flex items-center gap-1.5 text-sm">
                        <CheckCircle2 className="size-4" />
                        Správně.
                      </p>
                    ))}
                </fieldset>
              </li>
            ))}
          </ol>

          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}

          {vysledek && (
            <Alert role="status">
              {vysledek.splneno ? <CheckCircle2 /> : <XCircle />}
              <AlertTitle>
                {vysledek.splneno ? "Kvíz je splněný" : "Tentokrát to nestačilo"}:{" "}
                {vysledek.spravne} z {vysledek.celkem} správně.
              </AlertTitle>
              <AlertDescription>
                {vysledek.splneno
                  ? "Výborně, můžete pokračovat."
                  : `Ke splnění je potřeba aspoň ${prah} %. Podívejte se na lekci znovu a zkuste to ještě jednou.`}
              </AlertDescription>
            </Alert>
          )}

          {vysledek?.certifikat && (
            <Alert role="status">
              <Award />
              <AlertTitle>Máte certifikát o absolvování kurzu.</AlertTitle>
              <AlertDescription>
                <Link href={`/ucet/kurzy/${kurzId}`} className="underline underline-offset-4">
                  Stáhnout ho můžete na stránce kurzu.
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {vysledek ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setVysledek(null);
                setOdpovedi(kviz.otazky.map(() => null));
              }}
            >
              <RotateCcw />
              Zkusit znovu
            </Button>
          ) : (
            <Button type="submit" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Vyhodnotit
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
