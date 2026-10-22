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
import { POPIS_UDALOSTI, UDALOSTI_WEBHOOKU, type UdalostWebhooku } from "@/lib/webhooky-druhy";

import { ulozWebhook } from "./actions";

export interface WebhookKUprave {
  id: string;
  name: string;
  url: string;
  events: string[];
}

/**
 * Nový webhook a jeho úprava — jen administrátor (roli hlídá akce). Po
 * založení se jednou ukáže tajemství k podpisu; pak už nikdy.
 */
export function WebhookDialog({ webhook }: { webhook?: WebhookKUprave }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [tajemstvi, setTajemstvi] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  const zavri = () => {
    setOtevreno(false);
    setChyba(null);
    setTajemstvi(null);
  };

  return (
    <>
      <Button
        variant={webhook ? "outline" : "default"}
        size={webhook ? "sm" : "default"}
        onClick={() => setOtevreno(true)}
      >
        {webhook ? <Pencil /> : <Plus />}
        {webhook ? "Upravit" : "Nový webhook"}
      </Button>

      <Dialog open={otevreno} onOpenChange={(stav) => (stav ? setOtevreno(true) : zavri())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{webhook ? "Upravit webhook" : "Nový webhook"}</DialogTitle>
            <DialogDescription>
              CRM pošle zprávu na tuhle adresu, když se stane vybraná událost. Ve zprávách nejsou
              e-maily ani telefony klientů.
            </DialogDescription>
          </DialogHeader>

          {tajemstvi ? (
            <div className="space-y-3">
              <Alert>
                <AlertDescription>
                  Tajemství k ověření podpisu zpráv. <strong>Uložte si ho teď</strong> — už ho
                  neuvidíte. Když ho ztratíte, webhook smažte a založte znovu.
                </AlertDescription>
              </Alert>
              <Input
                readOnly
                value={tajemstvi}
                aria-label="Tajemství webhooku"
                className="font-mono"
                onFocus={(udalost) => udalost.currentTarget.select()}
              />
              <DialogFooter>
                <Button onClick={zavri}>Hotovo</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <form
                id="webhook-formular"
                onSubmit={(udalost) => {
                  udalost.preventDefault();
                  // Ne `action`: React by po odmítnutí ze serveru vyprázdnil pole.
                  const formData = new FormData(udalost.currentTarget);
                  zahaj(async () => {
                    setChyba(null);
                    const vysledek = await ulozWebhook(formData);
                    if (!vysledek.ok) {
                      setChyba(vysledek.chyba);
                      return;
                    }
                    toast.success(vysledek.zprava);
                    router.refresh();
                    if (vysledek.tajemstvi) setTajemstvi(vysledek.tajemstvi);
                    else zavri();
                  });
                }}
                className="space-y-4"
              >
                {chyba && (
                  <Alert variant="destructive">
                    <AlertDescription>{chyba}</AlertDescription>
                  </Alert>
                )}
                {webhook && <input type="hidden" name="id" value={webhook.id} />}

                <div className="space-y-2">
                  <Label htmlFor="webhook-nazev">Název</Label>
                  <Input
                    id="webhook-nazev"
                    name="name"
                    defaultValue={webhook?.name}
                    placeholder="Zapier — tabulka objednávek"
                    maxLength={100}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhook-adresa">Adresa</Label>
                  <Input
                    id="webhook-adresa"
                    name="url"
                    type="url"
                    inputMode="url"
                    defaultValue={webhook?.url}
                    placeholder="https://hooks.zapier.com/…"
                    maxLength={500}
                    required
                  />
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Události</legend>
                  {UDALOSTI_WEBHOOKU.map((udalost: UdalostWebhooku) => (
                    <label key={udalost} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="events"
                        value={udalost}
                        defaultChecked={webhook?.events.includes(udalost)}
                        className="accent-primary size-4 shrink-0"
                      />
                      {POPIS_UDALOSTI[udalost]}
                    </label>
                  ))}
                </fieldset>
              </form>

              <DialogFooter>
                <Button variant="outline" onClick={zavri}>
                  Zrušit
                </Button>
                <Button type="submit" form="webhook-formular" disabled={ceka}>
                  {ceka && <Loader2 className="animate-spin" />}
                  Uložit
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
