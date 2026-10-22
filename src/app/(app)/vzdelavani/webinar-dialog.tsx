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

import { ulozWebinar } from "./webinare-actions";

export interface WebinarKUprave {
  id: string;
  title: string;
  description: string;
  /** `RRRR-MM-DDTHH:MM` v pražském čase (`casProPole()`). */
  startsAt: string;
  durationMinutes: number;
  joinUrl: string;
  audience: "VSICHNI" | "CLENOVE" | "KURZ";
  courseId: string;
  /** Posílat klientům připomínku den a hodinu předem (5C, 11. 10. 2026). */
  remindersEnabled: boolean;
}

const PUBLIKUM = [
  ["VSICHNI", "Všichni klienti s účtem"],
  ["CLENOVE", "Jen členové (platné členství)"],
  ["KURZ", "Kupci jednoho kurzu"],
] as const;

/** Nový webinář a jeho úprava — jen administrátor (roli hlídá akce). */
export function WebinarDialog({
  kurzy,
  webinar,
}: {
  kurzy: { id: string; title: string }[];
  webinar?: WebinarKUprave;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [publikum, setPublikum] = useState(webinar?.audience ?? "VSICHNI");
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant={webinar ? "outline" : "default"} onClick={() => setOtevreno(true)}>
        {webinar ? <Pencil /> : <Plus />}
        {webinar ? "Upravit webinář" : "Nový webinář"}
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
            <DialogTitle>{webinar ? "Upravit webinář" : "Nový webinář"}</DialogTitle>
            <DialogDescription>
              Klienti, pro které je, ho uvidí v klientské části i s odkazem na připojení.
            </DialogDescription>
          </DialogHeader>

          <form
            id="webinar-formular"
            onSubmit={(udalost) => {
              udalost.preventDefault();
              // Ne `action`: React by po odmítnutí ze serveru vyprázdnil vyplněná pole.
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozWebinar(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                if (!webinar && vysledek.id) router.push(`/vzdelavani/webinare/${vysledek.id}`);
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
            {webinar && <input type="hidden" name="id" value={webinar.id} />}

            <div className="space-y-2">
              <Label htmlFor="webinar-title">Název</Label>
              <Input
                id="webinar-title"
                name="title"
                defaultValue={webinar?.title}
                required
                maxLength={200}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="webinar-start">Začátek</Label>
                <Input
                  id="webinar-start"
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={webinar?.startsAt}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webinar-delka">Délka v minutách</Label>
                <Input
                  id="webinar-delka"
                  name="durationMinutes"
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={600}
                  defaultValue={webinar?.durationMinutes ?? 60}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webinar-odkaz">Odkaz na připojení (nepovinné)</Label>
              <Input
                id="webinar-odkaz"
                name="joinUrl"
                type="url"
                inputMode="url"
                placeholder="https://…"
                defaultValue={webinar?.joinUrl}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webinar-popis">Popis (nepovinné)</Label>
              <Textarea
                id="webinar-popis"
                name="description"
                defaultValue={webinar?.description}
                maxLength={2000}
                rows={3}
              />
            </div>

            <div role="radiogroup" aria-labelledby="publikum-popisek" className="space-y-2">
              <p id="publikum-popisek" className="text-sm font-medium">
                Kdo ho uvidí
              </p>
              <div className="space-y-1.5">
                {PUBLIKUM.map(([volba, popisek]) => (
                  <label key={volba} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="audience"
                      value={volba}
                      required
                      checked={publikum === volba}
                      onChange={() => setPublikum(volba)}
                      className="accent-primary size-4"
                    />
                    {popisek}
                  </label>
                ))}
              </div>
            </div>

            {publikum === "KURZ" && (
              <div className="space-y-2">
                <Label htmlFor="webinar-kurz">Kurz</Label>
                <Select name="courseId" defaultValue={webinar?.courseId || undefined} required>
                  <SelectTrigger id="webinar-kurz" className="w-full">
                    <SelectValue placeholder="Vyber kurz" />
                  </SelectTrigger>
                  <SelectContent>
                    {kurzy.map((kurz) => (
                      <SelectItem key={kurz.id} value={kurz.id}>
                        {kurz.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Připomínka klientům (Fáze 5C, Jakub 11. 10. 2026). */}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="pripominka"
                defaultChecked={webinar?.remindersEnabled ?? true}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span>
                Poslat klientům připomínku den předem a hodinu předem
                <span className="text-muted-foreground block text-xs">
                  Oznámením na telefon, jinak e-mailem. Změna začátku pošle připomínky znovu.
                </span>
              </span>
            </label>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form="webinar-formular" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
