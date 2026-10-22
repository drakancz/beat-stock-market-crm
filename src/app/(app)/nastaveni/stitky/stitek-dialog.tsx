"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Stitek } from "@/components/stitky/stitek";
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
import type { TagColor } from "@/generated/prisma/enums";
import { BARVY_STITKU, PORADI_BAREV } from "@/lib/stitky-barvy";

import { ulozStitek } from "./actions";

/** Nový štítek a jeho úprava — jen administrátor (roli hlídá akce). */
export function StitekDialog({
  stitek,
}: {
  stitek?: { id: string; name: string; color: TagColor };
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [nazev, setNazev] = useState(stitek?.name ?? "");
  const [barva, setBarva] = useState<TagColor>(stitek?.color ?? "ZAKLADNI");
  const [ceka, zahaj] = useTransition();
  const nadpis = stitek ? "Upravit štítek" : "Nový štítek";
  const idFormulare = `stitek-${stitek?.id ?? "novy"}`;

  return (
    <>
      {stitek ? (
        <Button variant="ghost" size="icon" title={nadpis} onClick={() => setOtevreno(true)}>
          <Pencil />
          <span className="sr-only">
            {nadpis}: {stitek.name}
          </span>
        </Button>
      ) : (
        <Button onClick={() => setOtevreno(true)}>
          <Plus />
          Nový štítek
        </Button>
      )}

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nadpis}</DialogTitle>
            <DialogDescription>
              Štítek uvidí celý tým, klient nikdy. Pište ho tak, aby se nestyděl ani on — třeba
              „VIP“, „zájem o kurz Opce“.
            </DialogDescription>
          </DialogHeader>

          <form
            id={idFormulare}
            onSubmit={(udalost) => {
              udalost.preventDefault();
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozStitek(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                if (!stitek) setNazev("");
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            {stitek && <input type="hidden" name="id" value={stitek.id} />}

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-nazev`}>Název</Label>
              <Input
                id={`${idFormulare}-nazev`}
                name="name"
                value={nazev}
                onChange={(e) => setNazev(e.target.value)}
                required
                maxLength={40}
              />
            </div>

            <div role="radiogroup" aria-label="Barva" className="space-y-2">
              <p className="text-sm font-medium">Barva</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {PORADI_BAREV.map((volba) => (
                  <label key={volba} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="color"
                      value={volba}
                      checked={barva === volba}
                      onChange={() => setBarva(volba)}
                      aria-label={BARVY_STITKU[volba].nazev}
                      className="accent-primary size-4"
                    />
                    <Stitek nazev={nazev.trim() || BARVY_STITKU[volba].nazev} barva={volba} />
                  </label>
                ))}
              </div>
            </div>
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
