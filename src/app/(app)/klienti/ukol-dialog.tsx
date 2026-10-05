"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { PoleVyberu } from "@/components/pole-vyberu";
import { jakoDen } from "@/lib/obdobi";

import { upravUkol, zalozUkol } from "./ukoly-actions";

export interface UkolKUprave {
  id: string;
  title: string;
  dueAt: Date;
}

/**
 * Okno na založení a úpravu úkolu.
 *
 * Do 22. 9. 2026 tlačítko „Přidat úkol" na kartě klienta **nic nedělalo** —
 * vypadalo funkčně a nebylo. Tohle je jeho obsah.
 *
 * **Výběr majitele se nabízí jen vedení.** Obchodníkovi přijde prázdný
 * seznam a pole se vůbec nevykreslí; rozhoduje o tom `nactiMozneMajitele()`
 * na serveru. Je to úklid v rozhraní, ne ochrana — tou je kontrola
 * v samotné akci (security_warnings.md, pravidlo 5).
 *
 * Při úpravě se majitel nemění: přehazování úkolů mezi lidmi jsme
 * nezaváděli, protože by v seznamu nebylo poznat, kdo práci udělal.
 *
 * **Od 23. 9. 2026 žije na Dashboardu v Mém dni** (Jakub) — záložka
 * Úkoly na kartě klienta zmizela. Bez `klientId` se proto klient
 * vybírá v okně, stejně jako u zápisu hovoru v sekci Hovory. Při úpravě
 * se klient nemění.
 */
export function UkolDialog({
  klientId,
  klienti,
  majitele,
  ukol,
}: {
  /** Klient daný předem. Když chybí, vybírá se ze `klienti`. */
  klientId?: string;
  klienti?: { id: string; name: string }[];
  /** Koho jde vybrat jako majitele. Prázdné = zadávám jen sobě. */
  majitele: { id: string; name: string }[];
  /** Když chybí, formulář zakládá nový úkol. */
  ukol?: UkolKUprave;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  // Když server formulář odmítne, React by ho vyprázdnil a člověk by
  // psal všechno znovu — proto si poslední vyplněné hodnoty pamatujeme.
  const [zadane, setZadane] = useState<Record<string, string>>({});
  const [pokus, setPokus] = useState(0);

  const upravuje = ukol !== undefined;
  const hodnota = (klic: string, vychozi: string) => zadane[klic] ?? vychozi;

  // Výchozí termín je zítřek — úkol na dnešek se zadává málokdy.
  const zitra = new Date();
  zitra.setDate(zitra.getDate() + 1);

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) setChyba(null);
      }}
    >
      {upravuje ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOtevreno(true)}
          aria-label={`Upravit úkol ${ukol.title}`}
        >
          <Pencil />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOtevreno(true)}>
          <Plus />
          Nový úkol
        </Button>
      )}

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{upravuje ? "Upravit úkol" : "Nový úkol"}</DialogTitle>
          <DialogDescription>
            {upravuje
              ? "Oprava textu nebo termínu. Změna se zapíše do auditního logu."
              : klientId
                ? "Co je u tohohle klienta potřeba udělat a do kdy."
                : "U kterého klienta, co je potřeba udělat a do kdy."}
          </DialogDescription>
        </DialogHeader>

        <form
          key={pokus}
          action={(formData) => {
            setZadane(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
            setPokus((cislo) => cislo + 1);

            zahaj(async () => {
              const vysledek = upravuje ? await upravUkol(formData) : await zalozUkol(formData);

              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }

              toast.success(vysledek.zprava);
              setChyba(null);
              setZadane({});
              setOtevreno(false);
              router.refresh();
            });
          }}
          className="space-y-4"
        >
          {upravuje ? (
            <input type="hidden" name="id" value={ukol.id} />
          ) : klientId ? (
            <input type="hidden" name="clientId" value={klientId} />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="ukol-clientId">Klient</Label>
              {/* Pole s hledáním místo rozbalovacího seznamu (Jakub, 25. 9. 2026):
                  klientů bude moc a hledá se i bez diakritiky. Nic není
                  předvybrané — klienta si člověk musí zvolit sám. */}
              <PoleVyberu
                id="ukol-clientId"
                name="clientId"
                polozky={klienti ?? []}
                vychozi={hodnota("clientId", "")}
                popisekTlacitka="Vyber klienta"
                placeholderHledani="Hledat klienta…"
                prazdnyVysledek="Žádný klient tomu neodpovídá."
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Piš část jména, háčky a čárky psát nemusíš.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ukol-title">Co je potřeba</Label>
            <Input
              id="ukol-title"
              name="title"
              required
              maxLength={200}
              placeholder="Zavolat ohledně nabídky"
              defaultValue={hodnota("title", ukol?.title ?? "")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ukol-dueAt">Do kdy</Label>
            <Input
              id="ukol-dueAt"
              name="dueAt"
              type="date"
              required
              defaultValue={hodnota("dueAt", jakoDen(ukol?.dueAt ?? zitra))}
            />
          </div>

          {!upravuje && majitele.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="ukol-userId">Komu</Label>
              <Select name="userId" defaultValue={hodnota("userId", majitele[0]?.id ?? "")}>
                <SelectTrigger id="ukol-userId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {majitele.map((clovek) => (
                    <SelectItem key={clovek.id} value={clovek.id}>
                      {clovek.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              {upravuje ? "Uložit" : "Založit úkol"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
