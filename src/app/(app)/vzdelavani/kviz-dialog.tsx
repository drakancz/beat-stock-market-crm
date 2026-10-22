"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OtazkaKvizu } from "@/lib/vzdelavani/kvizy";

import { ulozKviz } from "./kurzy-actions";

import {
  MAX_MOZNOSTI,
  MAX_OTAZEK,
  MIN_MOZNOSTI,
  PRAH_KVIZU,
} from "@/lib/vzdelavani/kvizy-pravidla";

const prazdnaOtazka = (): OtazkaKvizu => ({ otazka: "", moznosti: ["", ""], spravna: -1 });

/**
 * Kvíz u lekce v CRM (Fáze 5C, 11. 10. 2026). **Upravuje jen
 * administrátor** — ochrana je v akci `ulozKviz()`; uživatel okno vidí
 * jen ke čtení (`jenCteni`). Otázka má 2–6 možností a jednu správnou.
 */
export function KvizDialog({
  lekceId,
  lekce,
  otazky: puvodni,
  jenCteni,
}: {
  lekceId: string;
  lekce: string;
  /** Stávající otázky, nebo `null` u lekce bez kvízu. */
  otazky: OtazkaKvizu[] | null;
  jenCteni?: boolean;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [otazky, setOtazky] = useState<OtazkaKvizu[]>([]);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  const nadpis = jenCteni ? "Kvíz" : puvodni ? "Upravit kvíz" : "Přidat kvíz";

  const zmen = (poradi: number, zmena: (otazka: OtazkaKvizu) => OtazkaKvizu) =>
    setOtazky((pred) => pred.map((o, i) => (i === poradi ? zmena(o) : o)));

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={nadpis}
        onClick={() => {
          setOtazky(
            puvodni ? puvodni.map((o) => ({ ...o, moznosti: [...o.moznosti] })) : [prazdnaOtazka()],
          );
          setChyba(null);
          setOtevreno(true);
        }}
      >
        <ListChecks className={puvodni ? "text-primary" : undefined} />
        <span className="sr-only">
          {nadpis}: {lekce}
        </span>
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {nadpis}: {lekce}
            </DialogTitle>
            <DialogDescription>
              Klient kvíz uvidí pod lekcí. Ke splnění potřebuje aspoň {PRAH_KVIZU} % správně,
              zkoušet může bez omezení. Certifikát dostane, až splní všechny kvízy kurzu a dokončí
              všechny lekce.
            </DialogDescription>
          </DialogHeader>

          <form
            id={`kviz-${lekceId}`}
            onSubmit={(udalost) => {
              udalost.preventDefault();
              if (jenCteni) return;
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozKviz(lekceId, otazky);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
              });
            }}
            className="space-y-5"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}

            <ol className="space-y-5">
              {otazky.map((otazka, poradi) => (
                <li key={poradi} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label htmlFor={`kviz-${lekceId}-${poradi}`}>Otázka {poradi + 1}</Label>
                      <Textarea
                        id={`kviz-${lekceId}-${poradi}`}
                        value={otazka.otazka}
                        onChange={(e) => zmen(poradi, (o) => ({ ...o, otazka: e.target.value }))}
                        rows={2}
                        maxLength={500}
                        required
                        readOnly={jenCteni}
                      />
                    </div>
                    {!jenCteni && otazky.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Odebrat otázku"
                        onClick={() => setOtazky((pred) => pred.filter((_, i) => i !== poradi))}
                      >
                        <X />
                        <span className="sr-only">Odebrat otázku {poradi + 1}</span>
                      </Button>
                    )}
                  </div>

                  <fieldset className="space-y-2">
                    <legend className="text-muted-foreground mb-2 text-xs">
                      Možnosti — správnou označ vlevo
                    </legend>
                    {otazka.moznosti.map((moznost, cislo) => (
                      <div key={cislo} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`spravna-${poradi}`}
                          checked={otazka.spravna === cislo}
                          onChange={() => zmen(poradi, (o) => ({ ...o, spravna: cislo }))}
                          disabled={jenCteni}
                          aria-label={`Správná odpověď u otázky ${poradi + 1}: možnost ${cislo + 1}`}
                          className="accent-primary size-4 shrink-0"
                        />
                        <Input
                          value={moznost}
                          onChange={(e) =>
                            zmen(poradi, (o) => ({
                              ...o,
                              moznosti: o.moznosti.map((m, i) =>
                                i === cislo ? e.target.value : m,
                              ),
                            }))
                          }
                          aria-label={`Otázka ${poradi + 1}, možnost ${cislo + 1}`}
                          maxLength={200}
                          required
                          readOnly={jenCteni}
                        />
                        {!jenCteni && otazka.moznosti.length > MIN_MOZNOSTI && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Odebrat možnost"
                            onClick={() =>
                              zmen(poradi, (o) => ({
                                ...o,
                                moznosti: o.moznosti.filter((_, i) => i !== cislo),
                                // Správná se posune s možnostmi; odebraná správná = žádná.
                                spravna:
                                  o.spravna === cislo
                                    ? -1
                                    : o.spravna > cislo
                                      ? o.spravna - 1
                                      : o.spravna,
                              }))
                            }
                          >
                            <X />
                            <span className="sr-only">
                              Odebrat možnost {cislo + 1} u otázky {poradi + 1}
                            </span>
                          </Button>
                        )}
                      </div>
                    ))}
                    {!jenCteni && otazka.moznosti.length < MAX_MOZNOSTI && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          zmen(poradi, (o) => ({ ...o, moznosti: [...o.moznosti, ""] }))
                        }
                      >
                        <Plus />
                        Přidat možnost
                      </Button>
                    )}
                  </fieldset>
                </li>
              ))}
            </ol>

            {!jenCteni && otazky.length < MAX_OTAZEK && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOtazky((pred) => [...pred, prazdnaOtazka()])}
              >
                <Plus />
                Přidat otázku
              </Button>
            )}

            {!jenCteni && (
              <Alert>
                <TriangleAlert />
                <AlertDescription className="text-xs leading-relaxed">
                  Otázky ověřují pochopení látky. Nesmí vypadat jako investiční doporučení (kupte,
                  prodejte, konkrétní cíle) — na to je potřeba licence.
                </AlertDescription>
              </Alert>
            )}
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              {jenCteni ? "Zavřít" : "Zrušit"}
            </Button>
            {!jenCteni && (
              <Button type="submit" form={`kviz-${lekceId}`} disabled={ceka}>
                {ceka && <Loader2 className="animate-spin" />}
                Uložit kvíz
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
