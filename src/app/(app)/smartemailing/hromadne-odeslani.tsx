"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { odesliCekajiciKlienty } from "./actions";

/**
 * Hromadné odeslání čekajících klientů — s potvrzovacím oknem, protože
 * najednou odchází osobní údaje mnoha lidí ven.
 */
export function HromadneOdeslani({
  pocet,
  nahled,
  nazevSeznamu,
  zapnuto,
  bezi,
  zbyva,
}: {
  pocet: number;
  nahled: string[];
  nazevSeznamu: string | null;
  zapnuto: boolean;
  bezi: boolean;
  zbyva: number;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  // Během odesílání se stránka sama obnovuje, ať je vidět postup.
  useEffect(() => {
    if (!bezi) return;
    const casovac = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(casovac);
  }, [bezi, router]);

  if (bezi) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Odesílá se — zbývá {zbyva}.
      </p>
    );
  }

  return (
    <>
      <Button disabled={!zapnuto || pocet === 0} onClick={() => setOtevreno(true)}>
        <Send />
        Odeslat čekající ({pocet})
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odeslat klienty do SmartEmailingu</DialogTitle>
            <DialogDescription>
              Do seznamu „{nazevSeznamu ?? "—"}“ odejde {pocet} klientů se souhlasem s marketingem,
              kteří tam ještě nejsou, včetně leadů z webu. Odchází jen e-mail, jméno a příjmení.
            </DialogDescription>
          </DialogHeader>

          <ul className="bg-muted my-2 max-h-48 space-y-1 overflow-y-auto rounded-md p-3 text-sm">
            {nahled.map((jmeno, i) => (
              <li key={i}>{jmeno}</li>
            ))}
            {pocet > nahled.length && (
              <li className="text-muted-foreground">a dalších {pocet - nahled.length}</li>
            )}
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await odesliCekajiciKlienty();
                  if (!vysledek.ok) {
                    // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                    toast.error(vysledek.chyba);
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Odeslat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
