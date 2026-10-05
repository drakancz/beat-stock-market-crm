"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
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

import { ulozKurz } from "./kurzy-actions";

/**
 * Založení a úprava kurzu (krok 3C) — jen administrátor; roli ověřuje
 * `ulozKurz()`. Kurz se vybírá z kurzů v ceníku, které ještě obsah nemají.
 */
export function KurzDialog({
  produkty,
  kurz,
}: {
  produkty: { id: string; name: string }[];
  kurz?: {
    id: string;
    productId: string;
    title: string;
    description: string;
    zverejneno: boolean;
  };
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant={kurz ? "outline" : "default"} onClick={() => setOtevreno(true)}>
        {kurz ? <Pencil /> : <Plus />}
        {kurz ? "Upravit kurz" : "Nový kurz"}
      </Button>

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{kurz ? "Upravit kurz" : "Nový kurz"}</DialogTitle>
            <DialogDescription>
              Obsah kurzu uvidí v klientské části ti, kdo mají tenhle kurz z ceníku zaplacený.
            </DialogDescription>
          </DialogHeader>

          {produkty.length === 0 && !kurz ? (
            <Alert>
              <AlertDescription>
                V ceníku není žádný kurz bez obsahu. Nejdřív přidej produkt druhu Kurz v sekci
                Produkty.
              </AlertDescription>
            </Alert>
          ) : (
            <form
              id="kurz-formular"
              onSubmit={(udalost) => {
                udalost.preventDefault();
                // Ne `action`: React by po odmítnutí ze serveru vyprázdnil vyplněná pole.
                const formData = new FormData(udalost.currentTarget);
                zahaj(async () => {
                  setChyba(null);
                  const vysledek = await ulozKurz(formData);
                  if (!vysledek.ok) {
                    setChyba(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  if (!kurz && vysledek.id) router.push(`/vzdelavani/kurzy/${vysledek.id}`);
                  else router.refresh();
                });
              }}
              className="space-y-4"
            >
              {chyba && (
                <Alert variant="destructive">
                  <AlertDescription>{chyba}</AlertDescription>
                </Alert>
              )}
              {kurz && <input type="hidden" name="id" value={kurz.id} />}

              <div className="space-y-2">
                <Label htmlFor="productId">Kurz v ceníku</Label>
                <Select name="productId" defaultValue={kurz?.productId} required>
                  <SelectTrigger id="productId" className="w-full">
                    <SelectValue placeholder="Vyber kurz" />
                  </SelectTrigger>
                  <SelectContent>
                    {produkty.map((produkt) => (
                      <SelectItem key={produkt.id} value={produkt.id}>
                        {produkt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Název pro klienty</Label>
                <Input
                  id="title"
                  name="title"
                  defaultValue={kurz?.title}
                  required
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Krátký popis (nepovinné)</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={kurz?.description}
                  maxLength={2000}
                  rows={3}
                />
              </div>

              <div role="radiogroup" aria-labelledby="zverejnit-popisek" className="space-y-2">
                <p id="zverejnit-popisek" className="text-sm font-medium">
                  Vidí ho klienti?
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {(
                    [
                      ["ne", "Koncept — zatím ne"],
                      ["ano", "Zveřejněno"],
                    ] as const
                  ).map(([volba, popisek]) => (
                    <label key={volba} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="zverejnit"
                        value={volba}
                        required
                        defaultChecked={(kurz?.zverejneno ? "ano" : "ne") === volba}
                        className="accent-primary size-4"
                      />
                      {popisek}
                    </label>
                  ))}
                </div>
              </div>
            </form>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            {(produkty.length > 0 || kurz) && (
              <Button type="submit" form="kurz-formular" disabled={ceka}>
                {ceka && <Loader2 className="animate-spin" />}
                Uložit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
