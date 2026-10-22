"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PoleVyberu, type Polozka } from "@/components/pole-vyberu";
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

import { zarezervujKlientovi } from "./actions";

/**
 * Rezervace za klienta, který zavolá (Jakub, 19. 10. 2026) — smí každý
 * přihlášený. V nabídce jsou jen klienti s volnou zaplacenou konzultací;
 * server to ověří znovu.
 */
export function RezervaceZaKlienta({
  slotId,
  kdy,
  klienti,
}: {
  slotId: string;
  kdy: string;
  klienti: Polozka[];
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [klient, setKlient] = useState("");
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOtevreno(true)}>
        Zarezervovat klientovi
      </Button>

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zarezervovat klientovi</DialogTitle>
            <DialogDescription>
              Termín {kdy}. Použije se jedna zaplacená konzultace klienta a klient dostane
              potvrzení.
            </DialogDescription>
          </DialogHeader>

          <form
            id={`rezervace-${slotId}`}
            onSubmit={(udalost) => {
              udalost.preventDefault();
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await zarezervujKlientovi(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
              });
            }}
            className="space-y-3"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            <input type="hidden" name="slotId" value={slotId} />
            <PoleVyberu
              name="clientId"
              polozky={klienti}
              vychozi={klient}
              onZmena={setKlient}
              prazdna={{ hodnota: "", popisek: "Vyber klienta" }}
              popisekTlacitka="Vyber klienta"
              placeholderHledani="Hledat klienta…"
              prazdnyVysledek="Žádný klient s volnou konzultací tomu neodpovídá."
            />
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form={`rezervace-${slotId}`} disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Zarezervovat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
