"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
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
import { jakoDen } from "@/lib/obdobi";

import { upravPlatnost } from "../platnost-actions";

/**
 * Ruční úprava konce platnosti (Jakub, 24. 9. 2026) — třeba prodloužení
 * zdarma jako omluva, nebo ukončení.
 *
 * **Tlačítko dostane jen administrátor.** Není to ochrana — roli ověřuje
 * `upravPlatnost()` na serveru. Hodnoty žijí ve stavu okna, takže je
 * odmítnutí ze serveru nesmaže.
 */
export function UpravaPlatnosti({
  klientId,
  jmeno,
  produkty,
  konce,
}: {
  klientId: string;
  jmeno: string;
  /** Produkty, u kterých jde platnost upravit. */
  produkty: { id: string; name: string }[];
  /** Současný konec podle produktu (`RRRR-MM-DD`) — předvyplní se do data. */
  konce: Record<string, string>;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  const vychoziProdukt = produkty.find((produkt) => konce[produkt.id])?.id ?? produkty[0]?.id ?? "";
  const [produktId, setProduktId] = useState(vychoziProdukt);
  const [den, setDen] = useState(konce[vychoziProdukt] ?? "");

  function otevri() {
    // Vždycky od toho, co je uložené, ne od minule rozepsaného.
    setProduktId(vychoziProdukt);
    setDen(konce[vychoziProdukt] ?? jakoDen(new Date()));
    setChyba(null);
    setOtevreno(true);
  }

  if (produkty.length === 0) return null;

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        if (stav) otevri();
        else setOtevreno(false);
      }}
    >
      <Button variant="outline" size="sm" onClick={otevri}>
        <CalendarClock />
        Upravit platnost
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upravit platnost</DialogTitle>
          <DialogDescription>
            Do kdy klientovi {jmeno} produkt běží. Zadané datum přebije dosavadní platby; další
            zaplacení na něj naváže. Datum v minulosti platnost ukončí. Změna se zapíše do auditního
            logu.
          </DialogDescription>
        </DialogHeader>

        <form
          method="post"
          className="space-y-4"
          onSubmit={(udalost) => {
            udalost.preventDefault();
            zahaj(async () => {
              const vysledek = await upravPlatnost(klientId, produktId, den);
              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                toast.error(vysledek.chyba);
                return;
              }
              toast.success(vysledek.zprava);
              setOtevreno(false);
              router.refresh();
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="platnost-produkt">Produkt</Label>
            <Select
              value={produktId}
              onValueChange={(hodnota) => {
                setProduktId(hodnota);
                if (konce[hodnota]) setDen(konce[hodnota]);
              }}
            >
              <SelectTrigger id="platnost-produkt" className="w-full">
                <SelectValue placeholder="Vyber produkt" />
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
            <Label htmlFor="platnost-do">Platí do (včetně)</Label>
            <Input
              id="platnost-do"
              type="date"
              required
              value={den}
              onChange={(udalost) => setDen(udalost.target.value)}
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
            <Button type="submit" disabled={ceka || !produktId || !den}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
