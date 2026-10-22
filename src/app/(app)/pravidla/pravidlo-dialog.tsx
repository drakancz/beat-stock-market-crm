"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  DRUHY_AKCI,
  DRUHY_PODMINEK,
  MEZE,
  type Akce,
  type Podminka,
} from "@/lib/vlastni-pravidla-druhy";

import { ulozVlastniPravidlo } from "./vlastni-actions";

type Polozka = { id: string; name: string };

export interface NabidkaPravidla {
  stitky: Polozka[];
  pole: (Polozka & { hodnoty: string[] })[];
  produkty: Polozka[];
  tym: Polozka[];
}

/** Obyčejný rozbalovací seznam ve stylu polí formuláře. */
function Vyber({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none focus-visible:ring-3 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function novaPodminka(druh: Podminka["druh"], n: NabidkaPravidla): Podminka {
  switch (druh) {
    case "stitek":
      return { druh, tagId: n.stitky[0]?.id ?? "", ma: true };
    case "pole":
      return { druh, fieldId: n.pole[0]?.id ?? "", hodnota: n.pole[0]?.hodnoty[0] ?? "" };
    case "nechodi":
      return { druh, dni: 30 };
    case "koupil":
      return { druh, productId: n.produkty[0]?.id ?? "" };
    case "konci":
      return { druh, dni: 14 };
  }
}

function novaAkce(druh: Akce["druh"], n: NabidkaPravidla): Akce {
  switch (druh) {
    case "ukol":
      return { druh, userId: n.tym[0]?.id ?? "", nazev: "" };
    case "zprava":
      return { druh, nadpis: "", text: "" };
    case "stitek":
      return { druh, tagId: n.stitky[0]?.id ?? "", pridat: true };
  }
}

/**
 * Skladač vlastního pravidla — jen administrátor (roli hlídá akce, odkazy
 * na štítky, pole, produkty a kolegy ověří server znovu).
 */
export function PravidloDialog({
  nabidka,
  pravidlo,
}: {
  nabidka: NabidkaPravidla;
  pravidlo?: { id: string; name: string; podminky: Podminka[]; akce: Akce[] };
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nazev, setNazev] = useState(pravidlo?.name ?? "");
  const [podminky, setPodminky] = useState<Podminka[]>(pravidlo?.podminky ?? []);
  const [akce, setAkce] = useState<Akce[]>(pravidlo?.akce ?? []);
  const [ceka, zahaj] = useTransition();

  const zmenPodminku = (i: number, nova: Podminka) =>
    setPodminky((vse) => vse.map((p, j) => (j === i ? nova : p)));
  const zmenAkci = (i: number, nova: Akce) =>
    setAkce((vse) => vse.map((a, j) => (j === i ? nova : a)));

  const titulek = pravidlo ? "Upravit pravidlo" : "Nové pravidlo";

  return (
    <>
      <Button
        variant={pravidlo ? "outline" : "default"}
        size={pravidlo ? "sm" : "default"}
        onClick={() => setOtevreno(true)}
      >
        {pravidlo ? <Pencil /> : <Plus />}
        {pravidlo ? "Upravit" : "Nové pravidlo"}
      </Button>

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{titulek}</DialogTitle>
            <DialogDescription>
              Když platí všechny podmínky, CRM ráno udělá akce — každému klientovi jednou. Nové
              pravidlo je vypnuté, zapneš ho v seznamu.
            </DialogDescription>
          </DialogHeader>

          <form
            id="pravidlo-formular"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              const formData = new FormData();
              if (pravidlo) formData.set("id", pravidlo.id);
              formData.set(
                "pravidlo",
                JSON.stringify({ name: nazev, conditions: podminky, actions: akce }),
              );
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozVlastniPravidlo(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                if (!pravidlo) {
                  setNazev("");
                  setPodminky([]);
                  setAkce([]);
                }
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

            <div className="space-y-2">
              <Label htmlFor="pravidlo-nazev">Název</Label>
              <Input
                id="pravidlo-nazev"
                value={nazev}
                onChange={(udalost) => setNazev(udalost.target.value)}
                placeholder="VIP, který přestal chodit"
                maxLength={100}
                required
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Když (musí platit všechny)</legend>
              {podminky.map((p, i) => (
                <div
                  key={i}
                  data-testid="podminka"
                  className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2"
                >
                  <span className="text-sm font-medium">
                    {DRUHY_PODMINEK.find((d) => d.druh === p.druh)?.popis}
                  </span>
                  {p.druh === "stitek" && (
                    <>
                      <Vyber
                        aria-label="Má nebo nemá"
                        className="w-28"
                        value={p.ma ? "ma" : "nema"}
                        onChange={(e) => zmenPodminku(i, { ...p, ma: e.target.value === "ma" })}
                      >
                        <option value="ma">má</option>
                        <option value="nema">nemá</option>
                      </Vyber>
                      <Vyber
                        aria-label="Štítek"
                        className="flex-1"
                        value={p.tagId}
                        onChange={(e) => zmenPodminku(i, { ...p, tagId: e.target.value })}
                      >
                        {nabidka.stitky.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Vyber>
                    </>
                  )}
                  {p.druh === "pole" && (
                    <>
                      <Vyber
                        aria-label="Pole"
                        className="flex-1"
                        value={p.fieldId}
                        onChange={(e) => {
                          const pole = nabidka.pole.find((f) => f.id === e.target.value);
                          zmenPodminku(i, {
                            ...p,
                            fieldId: e.target.value,
                            hodnota: pole?.hodnoty[0] ?? "",
                          });
                        }}
                      >
                        {nabidka.pole.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </Vyber>
                      <Vyber
                        aria-label="Hodnota pole"
                        className="flex-1"
                        value={p.hodnota}
                        onChange={(e) => zmenPodminku(i, { ...p, hodnota: e.target.value })}
                      >
                        {(nabidka.pole.find((f) => f.id === p.fieldId)?.hodnoty ?? []).map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </Vyber>
                    </>
                  )}
                  {(p.druh === "nechodi" || p.druh === "konci") && (
                    <label className="flex items-center gap-2 text-sm">
                      <Input
                        type="number"
                        inputMode="numeric"
                        aria-label="Počet dní"
                        className="w-20"
                        min={MEZE.dniOd}
                        max={MEZE.dniDo}
                        value={p.dni}
                        onChange={(e) => zmenPodminku(i, { ...p, dni: Number(e.target.value) })}
                      />
                      dní
                    </label>
                  )}
                  {p.druh === "koupil" && (
                    <Vyber
                      aria-label="Produkt"
                      className="flex-1"
                      value={p.productId}
                      onChange={(e) => zmenPodminku(i, { ...p, productId: e.target.value })}
                    >
                      {nabidka.produkty.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name}
                        </option>
                      ))}
                    </Vyber>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label="Odebrat podmínku"
                    onClick={() => setPodminky((vse) => vse.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              {podminky.length < MEZE.podminek && (
                <Vyber
                  aria-label="Přidat podmínku"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setPodminky((vse) => [
                      ...vse,
                      novaPodminka(e.target.value as Podminka["druh"], nabidka),
                    ]);
                  }}
                >
                  <option value="">+ Přidat podmínku…</option>
                  {DRUHY_PODMINEK.filter(
                    (d) =>
                      (d.druh !== "stitek" || nabidka.stitky.length > 0) &&
                      (d.druh !== "pole" || nabidka.pole.length > 0),
                  ).map((d) => (
                    <option key={d.druh} value={d.druh}>
                      {d.popis}
                    </option>
                  ))}
                </Vyber>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Udělá</legend>
              {akce.map((a, i) => (
                <div
                  key={i}
                  data-testid="akce"
                  className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2"
                >
                  <span className="text-sm font-medium">
                    {DRUHY_AKCI.find((d) => d.druh === a.druh)?.popis}
                  </span>
                  {a.druh === "ukol" && (
                    <>
                      <Vyber
                        aria-label="Komu"
                        className="flex-1"
                        value={a.userId}
                        onChange={(e) => zmenAkci(i, { ...a, userId: e.target.value })}
                      >
                        {nabidka.tym.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Vyber>
                      <Input
                        aria-label="Název úkolu"
                        placeholder="Ozvat se klientovi"
                        maxLength={MEZE.nazevUkolu}
                        value={a.nazev}
                        onChange={(e) => zmenAkci(i, { ...a, nazev: e.target.value })}
                      />
                    </>
                  )}
                  {a.druh === "zprava" && (
                    <div className="w-full space-y-2">
                      <Input
                        aria-label="Nadpis zprávy"
                        placeholder="Chybíte nám"
                        maxLength={MEZE.nadpisZpravy}
                        value={a.nadpis}
                        onChange={(e) => zmenAkci(i, { ...a, nadpis: e.target.value })}
                      />
                      <Textarea
                        aria-label="Text zprávy"
                        rows={3}
                        maxLength={MEZE.textZpravy}
                        value={a.text}
                        onChange={(e) => zmenAkci(i, { ...a, text: e.target.value })}
                      />
                      <p className="text-muted-foreground text-xs">
                        Jen klientům s účtem v klientské části. Žádná investiční doporučení
                        (pravidlo 9) — zpráva se ukáže i na zamčeném telefonu.
                      </p>
                    </div>
                  )}
                  {a.druh === "stitek" && (
                    <>
                      <Vyber
                        aria-label="Přidat nebo odebrat"
                        className="w-28"
                        value={a.pridat ? "pridat" : "odebrat"}
                        onChange={(e) => zmenAkci(i, { ...a, pridat: e.target.value === "pridat" })}
                      >
                        <option value="pridat">přidat</option>
                        <option value="odebrat">odebrat</option>
                      </Vyber>
                      <Vyber
                        aria-label="Štítek akce"
                        className="flex-1"
                        value={a.tagId}
                        onChange={(e) => zmenAkci(i, { ...a, tagId: e.target.value })}
                      >
                        {nabidka.stitky.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Vyber>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label="Odebrat akci"
                    onClick={() => setAkce((vse) => vse.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              {akce.length < MEZE.akci && (
                <Vyber
                  aria-label="Přidat akci"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setAkce((vse) => [...vse, novaAkce(e.target.value as Akce["druh"], nabidka)]);
                  }}
                >
                  <option value="">+ Přidat akci…</option>
                  {DRUHY_AKCI.filter((d) => d.druh !== "stitek" || nabidka.stitky.length > 0).map(
                    (d) => (
                      <option key={d.druh} value={d.druh}>
                        {d.popis}
                      </option>
                    ),
                  )}
                </Vyber>
              )}
            </fieldset>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form="pravidlo-formular" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
