"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { popisSazby } from "@/lib/dph";
import { pocet } from "@/lib/mnozne";

import { upravSazbuDph } from "./actions";

export interface SazbaKUprave {
  id: string;
  name: string;
  rate: number;
  produktu: number;
}

/** Tři sazby DPH pod sebou, každá s vlastním formulářem. */
export function SazbyDph({ sazby }: { sazby: SazbaKUprave[] }) {
  return (
    <div className="divide-border divide-y">
      {sazby.map((sazba) => (
        <RadekSazby key={sazba.id} sazba={sazba} />
      ))}
    </div>
  );
}

/** Výše se píše česky, s čárkou; server to čte stejně. */
const naCislo = (text: string) => Number(text.replace(/\s|%/g, "").replace(",", "."));

function RadekSazby({ sazba }: { sazba: SazbaKUprave }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [chyba, setChyba] = useState<string | null>(null);

  // Hodnoty žijí ve stavu, ne ve formuláři — po odmítnutí ze serveru
  // tak člověk nepřijde o to, co napsal.
  const [nazev, setNazev] = useState(sazba.name);
  const [vyse, setVyse] = useState(String(sazba.rate).replace(".", ","));

  const zmeneno = nazev.trim() !== sazba.name || naCislo(vyse) !== sazba.rate;

  return (
    <form
      className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
      action={(formData) =>
        zahaj(async () => {
          setChyba(null);

          const vysledek = await upravSazbuDph(formData);

          if (!vysledek.ok) {
            setChyba(vysledek.chyba);
            toast.error(vysledek.chyba);
            return;
          }

          toast.success(vysledek.zprava);
          router.refresh();
        })
      }
    >
      <input type="hidden" name="id" value={sazba.id} />

      <div className="space-y-2">
        <Label htmlFor={`nazev-${sazba.id}`}>Název</Label>
        <Input
          id={`nazev-${sazba.id}`}
          name="name"
          value={nazev}
          onChange={(udalost) => setNazev(udalost.target.value)}
          maxLength={40}
          autoComplete="off"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`vyse-${sazba.id}`}>Výše v %</Label>
        <Input
          id={`vyse-${sazba.id}`}
          name="rate"
          value={vyse}
          onChange={(udalost) => setVyse(udalost.target.value)}
          inputMode="decimal"
          maxLength={7}
          autoComplete="off"
          required
        />
      </div>

      <Button type="submit" variant="outline" disabled={ceka || !zmeneno}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit
      </Button>

      <div className="text-xs leading-relaxed sm:col-span-3">
        <p className="text-muted-foreground">
          Teď {popisSazby(sazba.rate)} ·{" "}
          {sazba.produktu > 0
            ? `v této sazbě: ${pocet(sazba.produktu, "produkt", "produkty", "produktů")}`
            : "zatím ji nepoužívá žádný produkt"}
        </p>
        {chyba && (
          <p role="alert" className="text-destructive mt-1">
            {chyba}
          </p>
        )}
      </div>
    </form>
  );
}
