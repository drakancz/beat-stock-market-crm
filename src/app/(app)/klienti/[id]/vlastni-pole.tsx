"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
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
import type { ClientFieldKind } from "@/generated/prisma/enums";
import { MAX_TEXT, zobrazHodnotu } from "@/lib/vlastni-pole-druhy";

import { ulozVlastniPole } from "../pole-actions";

type Pole = {
  id: string;
  name: string;
  kind: ClientFieldKind;
  options: string[];
  hodnota: string | null;
};

/** Ve výběru se prázdná volba posílá jako prázdný text — hodnota se smaže. */
const NIC = "__nic__";

/**
 * Vlastní pole na kartě klienta (Fáze 5B, 18. 10. 2026). Vidí a vyplňuje
 * každý přihlášený; seznam polí spravuje administrátor v Nastavení.
 */
export function VlastniPoleKlienta({ klientId, pole }: { klientId: string; pole: Pole[] }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  if (pole.length === 0) return null;

  return (
    <section aria-label="Vlastní pole" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Vlastní pole</h3>
        <Button variant="ghost" size="sm" onClick={() => setOtevreno(true)}>
          <Pencil />
          Vyplnit pole
        </Button>
      </div>
      <dl className="space-y-1 text-sm">
        {pole.map((p) => (
          <div key={p.id} className="flex justify-between gap-3">
            <dt className="text-muted-foreground shrink-0">{p.name}</dt>
            <dd className="min-w-0 text-right break-words">
              {p.hodnota === null ? "—" : zobrazHodnotu(p.kind, p.hodnota)}
            </dd>
          </div>
        ))}
      </dl>

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vlastní pole</DialogTitle>
            <DialogDescription>
              Prázdné pole se smaže. Klient tyhle údaje nikdy nevidí.
            </DialogDescription>
          </DialogHeader>
          <form
            id="vlastni-pole"
            className="space-y-4"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
              const data = new FormData(udalost.currentTarget);
              for (const [klic, hodnota] of data.entries()) {
                if (hodnota === NIC) data.set(klic, "");
              }
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozVlastniPole(klientId, data);
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
            {pole.map((p) => (
              <PoleVeFormulari key={p.id} pole={p} />
            ))}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form="vlastni-pole" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PoleVeFormulari({ pole }: { pole: Pole }) {
  const id = `vlastni-pole-${pole.id}`;
  const nazev = `pole-${pole.id}`;
  const vychozi = pole.hodnota ?? "";

  if (pole.kind === "ANO_NE" || pole.kind === "VYBER") {
    const moznosti =
      pole.kind === "ANO_NE"
        ? [
            ["ano", "Ano"],
            ["ne", "Ne"],
          ]
        : pole.options.map((moznost) => [moznost, moznost]);
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{pole.name}</Label>
        <Select name={nazev} defaultValue={pole.hodnota ?? NIC}>
          <SelectTrigger id={id} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NIC}>—</SelectItem>
            {moznosti.map(([hodnota, popis]) => (
              <SelectItem key={hodnota} value={hodnota!}>
                {popis}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{pole.name}</Label>
      <Input
        id={id}
        name={nazev}
        defaultValue={vychozi}
        type={pole.kind === "DATUM" ? "date" : "text"}
        inputMode={pole.kind === "CISLO" ? "decimal" : undefined}
        maxLength={MAX_TEXT}
      />
    </div>
  );
}
