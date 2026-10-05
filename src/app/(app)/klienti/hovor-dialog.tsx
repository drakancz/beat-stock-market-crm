"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, PhoneCall } from "lucide-react";
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
import type { CallOutcome } from "@/generated/prisma/enums";
import { OUTCOME_LABEL, RUCNI_VYSLEDKY } from "@/lib/types";

import { upravHovor, zapisHovor } from "./actions";
import { BEZ_PRODUKTU } from "./vyber-produktu";

export interface ProduktKVyberu {
  id: string;
  name: string;
}

export interface HovorKUprave {
  id: string;
  at: Date;
  durationMin: number;
  outcome: CallOutcome;
  note: string;
  interestProductId: string | null;
}

/**
 * Datum a čas pro pole `datetime-local`, **v pražském čase**.
 *
 * `toISOString()` by dalo čas v UTC a formulář by nabídl o dvě hodiny
 * míň, než kolik je člověku na hodinách.
 */
function proPole(hodnota: Date): string {
  const casti = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(hodnota);

  // `sv-SE` dá `2026-09-09 14:30`, pole chce `2026-09-09T14:30`.
  return casti.replace(" ", "T");
}

/**
 * Zápis hovoru — stejný formulář pro nový i pro úpravu.
 *
 * **Zapsat smí každý, kdo klienta vidí; upravit jen autor a administrátor**
 * (Jakub, 9. 9. 2026). Že se tlačítko Upravit nezobrazí cizímu hovoru,
 * není ochrana — serverová akce si nárok ověřuje znovu.
 */
export function HovorDialog({
  klientId,
  klienti,
  produkty,
  hovor,
}: {
  /** Karta klienta zná klienta předem a nenabízí ho k výběru. */
  klientId?: string;
  /**
   * Klienti k výběru. Používá se v přehledu Hovory, kde se zapisuje
   * mimo kartu konkrétního klienta. Server si nárok na vybraného
   * klienta stejně ověřuje znovu.
   */
  klienti?: { id: string; name: string }[];
  produkty: ProduktKVyberu[];
  /** Když chybí, formulář zapisuje nový hovor. */
  hovor?: HovorKUprave;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  // Když server formulář odmítne, React by ho vyprázdnil a člověk by
  // psal všechno znovu — proto si poslední vyplněné hodnoty pamatujeme.
  const [zadane, setZadane] = useState<Record<string, string>>({});
  const [pokus, setPokus] = useState(0);

  const upravuje = hovor !== undefined;

  const hodnota = (klic: string, vychozi: string) => zadane[klic] ?? vychozi;

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
          aria-label="Upravit hovor"
        >
          <Pencil />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOtevreno(true)}>
          <PhoneCall />
          Zapsat hovor
        </Button>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{upravuje ? "Upravit hovor" : "Zapsat hovor"}</DialogTitle>
          <DialogDescription>
            {upravuje
              ? "Oprava zapsaného hovoru. Změna se zapíše do auditního logu."
              : "Co se na hovoru domluvilo. Zapisuje se rovnou k tomuhle klientovi."}
          </DialogDescription>
        </DialogHeader>

        <form
          key={pokus}
          action={(formData) => {
            setZadane(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
            setPokus((cislo) => cislo + 1);

            zahaj(async () => {
              const vysledek = upravuje ? await upravHovor(formData) : await zapisHovor(formData);

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
          {klientId ? (
            <input type="hidden" name="clientId" value={klientId} />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="clientId">Klient</Label>
              <Select name="clientId" defaultValue={hodnota("clientId", "")}>
                <SelectTrigger id="clientId" className="w-full">
                  <SelectValue placeholder="Vyber klienta" />
                </SelectTrigger>
                <SelectContent>
                  {(klienti ?? []).map((klient) => (
                    <SelectItem key={klient.id} value={klient.id}>
                      {klient.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {upravuje && <input type="hidden" name="id" value={hovor.id} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="at">Kdy proběhl</Label>
              <Input
                id="at"
                name="at"
                type="datetime-local"
                required
                defaultValue={hodnota("at", proPole(hovor?.at ?? new Date()))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="durationMin">Délka v minutách</Label>
              <Input
                id="durationMin"
                name="durationMin"
                type="number"
                min={0}
                max={600}
                required
                defaultValue={hodnota("durationMin", String(hovor?.durationMin ?? 5))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outcome">Jak dopadl</Label>
            <Select name="outcome" defaultValue={hodnota("outcome", hovor?.outcome ?? "DOVOLANO")}>
              <SelectTrigger id="outcome" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUCNI_VYSLEDKY.map((vysledek) => (
                  <SelectItem key={vysledek} value={vysledek}>
                    {OUTCOME_LABEL[vysledek]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="interestProductId">Zájem o produkt</Label>
            <Select
              name="interestProductId"
              defaultValue={hodnota("interestProductId", hovor?.interestProductId ?? BEZ_PRODUKTU)}
            >
              <SelectTrigger id="interestProductId" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BEZ_PRODUKTU}>Nepadl konkrétní produkt</SelectItem>
                {produkty.map((produkt) => (
                  <SelectItem key={produkt.id} value={produkt.id}>
                    {produkt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Poznámka</Label>
            <Textarea
              id="note"
              name="note"
              rows={4}
              maxLength={5000}
              placeholder="Co se domluvilo a co je dál potřeba."
              defaultValue={hodnota("note", hovor?.note ?? "")}
            />
          </div>

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
              {upravuje ? "Uložit" : "Zapsat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
