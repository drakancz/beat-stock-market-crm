"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ClientFieldKind } from "@/generated/prisma/enums";
import { DRUHY_POLI, MAX_NAZEV, POPIS_DRUHU } from "@/lib/vlastni-pole-druhy";

import { posunPole, ulozPole } from "./actions";

/**
 * Založení a úprava vlastního pole (Fáze 5B, 18. 10. 2026) — jen
 * administrátor, hlídá to `ulozPole()`. Druh se po založení nemění.
 */
export function PoleDialog({
  pole,
}: {
  pole?: { id: string; name: string; kind: ClientFieldKind; options: string[] };
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [druh, setDruh] = useState<ClientFieldKind | null>(pole?.kind ?? null);
  const [ceka, zahaj] = useTransition();
  const nove = !pole;
  const nadpis = nove ? "Nové pole" : "Upravit pole";
  const idFormulare = `pole-${pole?.id ?? "nove"}`;

  return (
    <>
      {nove ? (
        <Button onClick={() => setOtevreno(true)}>
          <Plus />
          Nové pole
        </Button>
      ) : (
        <Button variant="ghost" size="icon" title={nadpis} onClick={() => setOtevreno(true)}>
          <Pencil />
          <span className="sr-only">Upravit pole: {pole.name}</span>
        </Button>
      )}

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{nadpis}</DialogTitle>
            <DialogDescription>
              Pole uvidí a vyplní celý tým na kartě klienta. Klient ho nikdy nevidí.
            </DialogDescription>
          </DialogHeader>

          <form
            id={idFormulare}
            className="space-y-4"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
              const data = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozPole(data);
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
            {pole && <input type="hidden" name="id" value={pole.id} />}

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-name`}>Název</Label>
              <Input
                id={`${idFormulare}-name`}
                name="name"
                required
                maxLength={MAX_NAZEV}
                defaultValue={pole?.name}
                placeholder="Zkušenost s investováním"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-kind`}>Druh</Label>
              {nove ? (
                <Select
                  name="kind"
                  value={druh ?? undefined}
                  onValueChange={(hodnota) => setDruh(hodnota as ClientFieldKind)}
                >
                  <SelectTrigger id={`${idFormulare}-kind`} className="w-full">
                    <SelectValue placeholder="Vyber druh" />
                  </SelectTrigger>
                  <SelectContent>
                    {DRUHY_POLI.map((moznost) => (
                      <SelectItem key={moznost} value={moznost}>
                        {POPIS_DRUHU[moznost]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p id={`${idFormulare}-kind`} className="text-sm">
                  {POPIS_DRUHU[pole.kind]}{" "}
                  <span className="text-muted-foreground">(po založení se nemění)</span>
                </p>
              )}
            </div>

            {druh === "VYBER" && (
              <div className="space-y-2">
                <Label htmlFor={`${idFormulare}-options`}>Možnosti — každá na svém řádku</Label>
                <Textarea
                  id={`${idFormulare}-options`}
                  name="options"
                  rows={5}
                  defaultValue={pole?.options.join("\n")}
                  placeholder={"začátečník\npokročilý\nprofesionál"}
                />
              </div>
            )}
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form={idFormulare} disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Šipky pro pořadí pole (jen administrátor — roli hlídá akce). */
export function PosunPole({
  id,
  nazev,
  prvni,
  posledni,
}: {
  id: string;
  nazev: string;
  prvni: boolean;
  posledni: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  function posun(smer: "nahoru" | "dolu") {
    zahaj(async () => {
      const vysledek = await posunPole(id, smer);
      if (!vysledek.ok) toast.error(vysledek.chyba);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Posunout nahoru"
        disabled={ceka || prvni}
        onClick={() => posun("nahoru")}
      >
        <ArrowUp />
        <span className="sr-only">Posunout nahoru: {nazev}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Posunout dolů"
        disabled={ceka || posledni}
        onClick={() => posun("dolu")}
      >
        <ArrowDown />
        <span className="sr-only">Posunout dolů: {nazev}</span>
      </Button>
    </>
  );
}
