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

import { ulozDoporucitele } from "./actions";

export interface DoporucitelKUprave {
  id: string;
  kind: "KLIENT" | "PARTNER";
  name: string;
  rewardPercent: number;
  note: string | null;
}

/**
 * Nový doporučitel a jeho úprava — jen administrátor (roli hlídá akce).
 *
 * Druh a klienta jde vybrat jen při založení; u hotového doporučitele se
 * mění jméno partnera, procento a poznámka.
 */
export function DoporucitelDialog({
  doporucitel,
  klienti,
}: {
  doporucitel?: DoporucitelKUprave;
  /** Klienti, kteří ještě doporučiteli nejsou — jen pro založení. */
  klienti: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [druh, setDruh] = useState<"KLIENT" | "PARTNER">(doporucitel?.kind ?? "KLIENT");
  const [ceka, zahaj] = useTransition();
  const nadpis = doporucitel ? "Upravit doporučitele" : "Nový doporučitel";
  const idf = `doporucitel-${doporucitel?.id ?? "novy"}`;

  const otevri = () => {
    setDruh(doporucitel?.kind ?? "KLIENT");
    setOtevreno(true);
  };

  return (
    <>
      {doporucitel ? (
        <Button variant="ghost" size="icon" title={nadpis} onClick={otevri}>
          <Pencil />
          <span className="sr-only">
            {nadpis}: {doporucitel.name}
          </span>
        </Button>
      ) : (
        <Button onClick={otevri}>
          <Plus />
          Nový doporučitel
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
              Odměna je procento z první zaplacené objednávky přivedeného klienta, z ceny po slevě
              bez DPH. Vyplácíte ji ručně.
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
                const vysledek = await ulozDoporucitele(formData);
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
            {doporucitel && <input type="hidden" name="id" value={doporucitel.id} />}

            {!doporucitel && (
              <div role="radiogroup" aria-label="Kdo doporučuje" className="space-y-2">
                <p className="text-sm font-medium">Kdo doporučuje</p>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {(
                    [
                      ["KLIENT", "Stávající klient"],
                      ["PARTNER", "Partner zvenku"],
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
            )}

            {!doporucitel && druh === "KLIENT" && (
              <div className="space-y-2">
                <Label htmlFor={`${idf}-klient`}>Klient</Label>
                <PoleVyberu
                  id={`${idf}-klient`}
                  name="clientId"
                  polozky={klienti}
                  prazdna={{ hodnota: "", popisek: "Vyber klienta" }}
                  popisekTlacitka="Klient"
                  placeholderHledani="Hledat klienta…"
                  prazdnyVysledek="Takový klient není."
                />
              </div>
            )}

            {(doporucitel ? doporucitel.kind === "PARTNER" : druh === "PARTNER") && (
              <div className="space-y-2">
                <Label htmlFor={`${idf}-name`}>Jméno partnera</Label>
                <Input
                  id={`${idf}-name`}
                  name="name"
                  defaultValue={doporucitel?.name}
                  required
                  maxLength={120}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor={`${idf}-procento`}>Odměna v %</Label>
              <Input
                id={`${idf}-procento`}
                name="rewardPercent"
                inputMode="decimal"
                defaultValue={
                  doporucitel ? String(doporucitel.rewardPercent).replace(".", ",") : ""
                }
                required
                className="max-w-40"
              />
              {doporucitel && (
                <p className="text-muted-foreground text-xs">
                  Změna platí pro odměny, které vzniknou od teď. Hotové se nepřepočítají.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idf}-note`}>Poznámka</Label>
              <Input
                id={`${idf}-note`}
                name="note"
                defaultValue={doporucitel?.note ?? ""}
                maxLength={200}
                placeholder="Vyplácí se na fakturu"
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
