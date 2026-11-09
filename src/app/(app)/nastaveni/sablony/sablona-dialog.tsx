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
import { Textarea } from "@/components/ui/textarea";
import { MAX_NAZEV_SABLONY, MAX_PREDMET, MAX_TEXT, ZASTUPCE_JMENA } from "@/lib/email-z-karty";

import { ulozSablonu } from "./actions";

export interface SablonaVeFormulari {
  id: string;
  name: string;
  subject: string;
  body: string;
}

/** Nová šablona e-mailu a její úprava — jen administrátor (roli hlídá akce). */
export function SablonaDialog({ sablona }: { sablona?: SablonaVeFormulari }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  const nadpis = sablona ? "Upravit šablonu" : "Nová šablona";
  const idFormulare = `sablona-${sablona?.id ?? "nova"}`;

  return (
    <>
      {sablona ? (
        <Button variant="ghost" size="icon" title={nadpis} onClick={() => setOtevreno(true)}>
          <Pencil />
          <span className="sr-only">
            {nadpis}: {sablona.name}
          </span>
        </Button>
      ) : (
        <Button onClick={() => setOtevreno(true)}>
          <Plus />
          Nová šablona
        </Button>
      )}

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{nadpis}</DialogTitle>
            <DialogDescription>
              Šablonu si vybere kdokoli z týmu v okně Poslat email na kartě klienta a před odesláním
              ji může upravit. Za {ZASTUPCE_JMENA} se doplní jméno klienta. Klientům se vyká.
            </DialogDescription>
          </DialogHeader>

          <form
            id={idFormulare}
            // Klíč obnoví výchozí hodnoty polí po každém otevření.
            key={otevreno ? "otevreno" : "zavreno"}
            onSubmit={(udalost) => {
              udalost.preventDefault();
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozSablonu(formData);
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
            {sablona && <input type="hidden" name="id" value={sablona.id} />}

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-nazev`}>Název šablony</Label>
              <Input
                id={`${idFormulare}-nazev`}
                name="name"
                defaultValue={sablona?.name}
                required
                maxLength={MAX_NAZEV_SABLONY}
                placeholder="Připomínka prodloužení"
              />
              <p className="text-muted-foreground text-xs">Klient ho neuvidí, slouží k výběru.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-predmet`}>Předmět e-mailu</Label>
              <Input
                id={`${idFormulare}-predmet`}
                name="subject"
                defaultValue={sablona?.subject}
                required
                maxLength={MAX_PREDMET}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-text`}>Text e-mailu</Label>
              <Textarea
                id={`${idFormulare}-text`}
                name="body"
                defaultValue={sablona?.body ?? `Dobrý den,\n\n`}
                required
                maxLength={MAX_TEXT}
                rows={10}
              />
              <p className="text-muted-foreground text-xs">
                Odstavce oddělte prázdným řádkem. Podpis a údaje firmy se doplní samy (Nastavení →
                Firma a e-maily).
              </p>
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
