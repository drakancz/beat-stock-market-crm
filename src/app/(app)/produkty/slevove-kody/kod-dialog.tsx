"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { PoleVyberu } from "@/components/pole-vyberu";
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

import { ulozKod } from "./actions";

export interface KodKUprave {
  id: string;
  code: string;
  kind: "PROCENTA" | "CASTKA";
  value: number;
  note: string | null;
  /** `RRRR-MM-DD`, nebo prázdné. */
  validFrom: string;
  validTo: string;
  maxUses: number | null;
  oncePerClient: boolean;
  produkty: string[];
  referrerId: string | null;
}

/** Nový slevový kód a jeho úprava — jen administrátor (roli hlídá akce). */
export function KodDialog({
  kod,
  produkty,
  doporucitele,
}: {
  kod?: KodKUprave;
  produkty: { id: string; name: string }[];
  /** Doporučitelé, kterým může kód patřit (5A, 15. 10. 2026). */
  doporucitele: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [druh, setDruh] = useState<"PROCENTA" | "CASTKA">(kod?.kind ?? "PROCENTA");
  const [ceka, zahaj] = useTransition();
  const nadpis = kod ? "Upravit slevový kód" : "Nový slevový kód";

  // Ostatní pole se při každém otevření vyplní znovu (okno se zavřením
  // zahodí), druh slevy je ale stav — bez tohohle by nový kód začínal
  // druhem z minula.
  const otevri = () => {
    setDruh(kod?.kind ?? "PROCENTA");
    setOtevreno(true);
  };
  const idf = `kod-${kod?.id ?? "novy"}`;

  return (
    <>
      {kod ? (
        <Button variant="ghost" size="icon" title={nadpis} onClick={otevri}>
          <Pencil />
          <span className="sr-only">
            {nadpis}: {kod.code}
          </span>
        </Button>
      ) : (
        <Button onClick={otevri}>
          <Plus />
          Nový kód
        </Button>
      )}

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{nadpis}</DialogTitle>
            <DialogDescription>
              Zákazník kód zadá na Landing Page. Všechna omezení jsou nepovinná — prázdné pole
              znamená bez omezení.
            </DialogDescription>
          </DialogHeader>

          <form
            id={idf}
            className="space-y-4"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozKod(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
              });
            }}
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            {kod && <input type="hidden" name="id" value={kod.id} />}

            <div className="space-y-2">
              <Label htmlFor={`${idf}-code`}>Kód</Label>
              <Input
                id={`${idf}-code`}
                name="code"
                defaultValue={kod?.code}
                required
                minLength={3}
                maxLength={40}
                autoCapitalize="characters"
                className="uppercase"
                placeholder="LETO20"
              />
              <p className="text-muted-foreground text-xs">
                Písmena bez diakritiky, číslice, pomlčka a podtržítko. Velikost písmen nehraje roli.
              </p>
            </div>

            <div role="radiogroup" aria-label="Druh slevy" className="space-y-2">
              <p className="text-sm font-medium">Druh slevy</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {(
                  [
                    ["PROCENTA", "V procentech"],
                    ["CASTKA", "V korunách s DPH"],
                  ] as const
                ).map(([hodnota, popis]) => (
                  <label key={hodnota} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="kind"
                      value={hodnota}
                      checked={druh === hodnota}
                      onChange={() => setDruh(hodnota)}
                      className="accent-primary size-4"
                    />
                    {popis}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idf}-value`}>
                {druh === "PROCENTA" ? "Sleva v %" : "Sleva v Kč s DPH"}
              </Label>
              <Input
                id={`${idf}-value`}
                name="value"
                inputMode="decimal"
                defaultValue={kod ? String(kod.value).replace(".", ",") : ""}
                required
                className="max-w-40"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${idf}-od`}>Platí od</Label>
                <Input
                  id={`${idf}-od`}
                  name="validFrom"
                  type="date"
                  defaultValue={kod?.validFrom}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idf}-do`}>Platí do (včetně)</Label>
                <Input id={`${idf}-do`} name="validTo" type="date" defaultValue={kod?.validTo} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idf}-max`}>Nejvýš kolikrát</Label>
              <Input
                id={`${idf}-max`}
                name="maxUses"
                inputMode="numeric"
                defaultValue={kod?.maxUses ?? ""}
                placeholder="neomezeně"
                className="max-w-40"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="oncePerClient"
                defaultChecked={kod?.oncePerClient}
                className="accent-primary size-4"
              />
              Jeden klient ho použije jen jednou
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Jen na produkty</legend>
              <p className="text-muted-foreground text-xs">
                Nic nezaškrtnuté = kód platí na všechny produkty.
              </p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {produkty.length === 0 ? (
                  <p className="text-muted-foreground text-xs">V ceníku zatím nic není.</p>
                ) : (
                  produkty.map((produkt) => (
                    <label key={produkt.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="produkty"
                        value={produkt.id}
                        defaultChecked={kod?.produkty.includes(produkt.id)}
                        className="accent-primary size-4 shrink-0"
                      />
                      <span className="min-w-0 break-words">{produkt.name}</span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            {/* Komu kód patří (5A, 15. 10. 2026): nový klient, který s ním
                poprvé objedná, je přivedený a doporučiteli vznikne odměna. */}
            <div className="space-y-2">
              <Label htmlFor={`${idf}-doporucitel`}>Patří doporučiteli</Label>
              <PoleVyberu
                id={`${idf}-doporucitel`}
                name="referrerId"
                polozky={doporucitele}
                vychozi={doporucitele.some((d) => d.id === kod?.referrerId) ? kod!.referrerId! : ""}
                prazdna={{ hodnota: "", popisek: "Nikomu — běžná sleva" }}
                popisekTlacitka="Patří doporučiteli"
                placeholderHledani="Hledat doporučitele…"
                prazdnyVysledek="Takový doporučitel není."
              />
              <p className="text-muted-foreground text-xs">
                Doporučitele zakládáš v Produkty → Doporučitelé.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idf}-note`}>Poznámka pro tým</Label>
              <Input
                id={`${idf}-note`}
                name="note"
                defaultValue={kod?.note ?? ""}
                maxLength={200}
                placeholder="Black Friday 2026"
              />
            </div>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form={idf} disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
