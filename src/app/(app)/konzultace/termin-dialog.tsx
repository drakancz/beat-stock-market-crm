"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
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

import { vypisTerminy } from "./actions";

/** Hodnota výběru „nikdo“ — Select nesnese prázdnou hodnotu. */
const NIKDO = "nikdo";

/** Vypsání termínů — jen administrátor (roli hlídá akce). */
export function TerminDialog({
  tym,
  vychoziVede,
}: {
  tym: { id: string; name: string }[];
  vychoziVede: string;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button onClick={() => setOtevreno(true)}>
        <Plus />
        Vypsat termíny
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
            <DialogTitle>Vypsat termíny</DialogTitle>
            <DialogDescription>
              Klienti se zaplacenou konzultací si volný termín zarezervují v klientské části. Kdo
              konzultaci vede, dostane po rezervaci úkol.
            </DialogDescription>
          </DialogHeader>

          <form
            id="termin-formular"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              // Ne `action`: React by po odmítnutí ze serveru vyprázdnil vyplněná pole.
              const formData = new FormData(udalost.currentTarget);
              if (formData.get("hostId") === NIKDO) formData.set("hostId", "");
              zahaj(async () => {
                setChyba(null);
                const vysledek = await vypisTerminy(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="termin-start">Začátek</Label>
                <Input id="termin-start" name="startsAt" type="datetime-local" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="termin-delka">Délka v minutách</Label>
                <Input
                  id="termin-delka"
                  name="durationMinutes"
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={240}
                  defaultValue={60}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="termin-opakovat">Kolik týdnů za sebou</Label>
              <Input
                id="termin-opakovat"
                name="opakovat"
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                defaultValue={1}
                required
              />
              <p className="text-muted-foreground text-xs">
                1 = jen tenhle termín. Třeba 4 vypíše stejný den a čas čtyři týdny po sobě.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="termin-vede">Kdo vede</Label>
              <Select name="hostId" defaultValue={vychoziVede}>
                <SelectTrigger id="termin-vede" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tym.map((clovek) => (
                    <SelectItem key={clovek.id} value={clovek.id}>
                      {clovek.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NIKDO}>Nikdo (bez úkolu)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="termin-misto">Kde (nepovinné)</Label>
              <Input
                id="termin-misto"
                name="place"
                placeholder="Online, kancelář…"
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="termin-odkaz">Odkaz na připojení (nepovinné)</Label>
              <Input
                id="termin-odkaz"
                name="joinUrl"
                type="url"
                inputMode="url"
                placeholder="https://…"
                maxLength={500}
              />
              <p className="text-muted-foreground text-xs">Klient ho uvidí až po rezervaci.</p>
            </div>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form="termin-formular" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Vypsat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
