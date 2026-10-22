"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import type { IdPravidla } from "@/lib/pravidla-druhy";

import { ulozPravidlo } from "./actions";

type Volba = { id: string; name: string };

/**
 * Nastavení jednoho pravidla (Fáze 5D, 18. 10. 2026) — jen administrátor,
 * hlídá to `ulozPravidlo()`. Každé pravidlo ukazuje jen pole, která potřebuje.
 */
export function FormularPravidla({
  pravidlo,
  produkty,
  stitky,
}: {
  pravidlo: {
    id: IdPravidla;
    nazev: string;
    enabled: boolean;
    /** Zaplaceno → štítek: řádky produkt → štítek. */
    dvojice: { productId: string; tagId: string }[];
    messageTitle: string | null;
    messageText: string | null;
  };
  produkty: Volba[];
  stitky: Volba[];
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const p = `pravidlo-${pravidlo.id}`;
  // Řádky produkt → štítek; bez žádného jeden prázdný, ať je co vyplnit.
  // Klíče jsou pořadová čísla — na serveru i v prohlížeči stejná.
  const [radky, setRadky] = useState(() =>
    (pravidlo.dvojice.length > 0 ? pravidlo.dvojice : [{ productId: "nic", tagId: "nic" }]).map(
      (d, i) => ({ klic: `r${i}`, ...d }),
    ),
  );
  const dalsiKlic = useRef(radky.length);
  function novyKlic(): string {
    dalsiKlic.current += 1;
    return `r${dalsiKlic.current}`;
  }

  return (
    <form
      className="space-y-4"
      aria-label={`Nastavení: ${pravidlo.nazev}`}
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozPravidlo(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={pravidlo.id} />

      {pravidlo.id === "nechodi-zprava" && (
        <>
          <div className="max-w-sm space-y-2">
            <Label htmlFor={`${p}-nadpis`}>Nadpis zprávy</Label>
            <Input
              id={`${p}-nadpis`}
              name="messageTitle"
              maxLength={80}
              defaultValue={pravidlo.messageTitle ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${p}-text`}>Text zprávy</Label>
            <Textarea
              id={`${p}-text`}
              name="messageText"
              rows={4}
              maxLength={1000}
              defaultValue={pravidlo.messageText ?? ""}
            />
            <p className="text-muted-foreground text-xs">
              Ukáže se i na zamčené obrazovce telefonu — bez citlivých údajů, bez reklamy a bez
              investičních rad.
            </p>
          </div>
        </>
      )}

      {pravidlo.id === "zaplaceno-stitek" && (
        // Seznam dvojic produkt → štítek (varianta A, Jakub 18. 10. 2026).
        <div className="space-y-3">
          {radky.map((radek, i) => (
            <div key={radek.klic} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-40 space-y-2">
                <Label htmlFor={`${p}-produkt-${radek.klic}`}>Po zaplacení produktu</Label>
                <Select name="productId" defaultValue={radek.productId}>
                  <SelectTrigger id={`${p}-produkt-${radek.klic}`} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nic">Žádný</SelectItem>
                    {produkty.map((produkt) => (
                      <SelectItem key={produkt.id} value={produkt.id}>
                        {produkt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1 basis-40 space-y-2">
                <Label htmlFor={`${p}-stitek-${radek.klic}`}>Přidat štítek</Label>
                <Select name="tagId" defaultValue={radek.tagId}>
                  <SelectTrigger id={`${p}-stitek-${radek.klic}`} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nic">Žádný</SelectItem>
                    {stitky.map((stitek) => (
                      <SelectItem key={stitek.id} value={stitek.id}>
                        {stitek.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Odebrat řádek ${i + 1}`}
                onClick={() => setRadky((dosud) => dosud.filter((r) => r.klic !== radek.klic))}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRadky((dosud) => [...dosud, { klic: novyKlic(), productId: "nic", tagId: "nic" }])
            }
          >
            <Plus />
            Přidat řádek
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={pravidlo.enabled}
            className="accent-primary size-4"
          />
          Zapnuto
        </label>
        <Button type="submit" disabled={ceka}>
          {ceka && <Loader2 className="animate-spin" />}
          Uložit
        </Button>
      </div>
    </form>
  );
}
