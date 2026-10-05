"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Loader2, Send, UserX } from "lucide-react";
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
import type { StavUctu } from "@/lib/klient/pozvanka";

import { pozvatDoKlientskeCasti, zrusitKlientskouCast } from "../ucet-actions";

/**
 * Tlačítka klientské části na kartě klienta — **jen administrátor**
 * (Jakub, 30. 9. 2026). Stav účtu vidí na kartě každý; tlačítka se
 * vykreslují jen administrátorovi a serverové akce roli ověřují znovu.
 */
export function KlientskaCast({
  klient,
  stav,
}: {
  klient: { id: string; name: string };
  stav: StavUctu;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [odkaz, setOdkaz] = useState<string | null>(null);
  const [zruseni, setZruseni] = useState(false);

  function pozvat() {
    zahaj(async () => {
      const vysledek = await pozvatDoKlientskeCasti(klient.id);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      if (vysledek.odkaz) setOdkaz(vysledek.odkaz);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {stav !== "aktivni" && (
        <Button variant="outline" size="sm" disabled={ceka} onClick={pozvat}>
          {ceka ? <Loader2 className="animate-spin" /> : <Send />}
          {stav === "pozvan" ? "Poslat pozvánku znovu" : "Pozvat do klientské části"}
        </Button>
      )}
      {(stav === "pozvan" || stav === "aktivni") && (
        <Button variant="outline" size="sm" onClick={() => setZruseni(true)}>
          <UserX />
          Zrušit přístup
        </Button>
      )}

      {/* Zrušení přístupu — potvrzovací okno jako u každého mazání. */}
      <Dialog open={zruseni} onOpenChange={setZruseni}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zrušit přístup do klientské části</DialogTitle>
            <DialogDescription>
              Zrušit přístup do klientské části: {klient.name}? Klient se okamžitě odhlásí a
              přihlásit se už nepůjde. Heslo i dvoufázové ověření se zahodí.{" "}
              <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>

          <Alert className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              Karta klienta, objednávky ani nic dalšího se nemění. Když bude klient přístup znovu
              potřebovat, pošli mu novou pozvánku — heslo si nastaví znovu.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setZruseni(false)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await zrusitKlientskouCast(klient.id);
                  if (!vysledek.ok) {
                    // Okno zůstane otevřené, ať je vidět, čeho se odmítnutí týká.
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setZruseni(false);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Zrušit přístup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Odkaz, když e-mail neodešel — administrátor ho předá klientovi. */}
      <Dialog open={odkaz !== null} onOpenChange={(otevreno) => !otevreno && setOdkaz(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odkaz na nastavení hesla</DialogTitle>
            <DialogDescription>
              Předej ho jen klientovi {klient.name}. Platí hodinu a dá se použít jednou.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3">
            <div className="bg-muted overflow-x-auto rounded-md p-3">
              <code className="font-mono text-xs break-all">{odkaz}</code>
            </div>
            <Alert>
              <AlertDescription className="text-xs leading-relaxed">
                Odkaz zastupuje heslo — neposílej ho nezabezpečeným kanálem a nikam si ho neukládej.
                Až budou e-maily na serveru fungovat, bude chodit klientovi sám.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                if (!odkaz) return;
                try {
                  await navigator.clipboard.writeText(odkaz);
                  toast.success("Odkaz zkopírován do schránky.");
                } catch {
                  toast.error("Zkopírování se nepovedlo, označ odkaz myší.");
                }
              }}
            >
              <Copy />
              Zkopírovat
            </Button>
            <Button onClick={() => setOdkaz(null)}>Hotovo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
