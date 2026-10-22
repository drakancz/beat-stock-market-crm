"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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

import { preloz, zarezervuj, zrus, type VysledekRezervace } from "./actions";

/**
 * Tlačítka rezervace v klientské části (Fáze 5B, 19. 10. 2026). Každé má
 * potvrzovací okno — rezervace spotřebuje zaplacenou konzultaci a zrušení
 * ji vrací. Při odmítnutí ze serveru okno zůstane otevřené s hláškou.
 */

function OknoAkce({
  tlacitko,
  varianta = "outline",
  titulek,
  popis,
  potvrdit,
  nebezpecne,
  zpet = "Zpět",
  obsah,
  akce,
}: {
  tlacitko: string;
  varianta?: "default" | "outline";
  titulek: string;
  popis: ReactNode;
  potvrdit: string;
  nebezpecne?: boolean;
  zpet?: string;
  obsah?: ReactNode;
  /** `null` = chybí volba (třeba nový termín u přeložení). */
  akce: () => Promise<VysledekRezervace> | null;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button variant={varianta} size="sm" onClick={() => setOtevreno(true)}>
        {tlacitko}
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
            <DialogTitle>{titulek}</DialogTitle>
            <DialogDescription>{popis}</DialogDescription>
          </DialogHeader>
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          {obsah}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              {zpet}
            </Button>
            <Button
              variant={nebezpecne ? "destructive" : "default"}
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  setChyba(null);
                  const pozadavek = akce();
                  if (!pozadavek) {
                    setChyba("Vyberte nový termín.");
                    return;
                  }
                  const vysledek = await pozadavek;
                  if (!vysledek.ok) {
                    setChyba(vysledek.chyba);
                    router.refresh();
                    return;
                  }
                  toast.success(vysledek.zprava);
                  setOtevreno(false);
                  router.refresh();
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              {potvrdit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Rezervovat({ slotId, popis }: { slotId: string; popis: string }) {
  return (
    <OknoAkce
      tlacitko="Zarezervovat"
      varianta="default"
      titulek="Zarezervovat konzultaci"
      popis={
        <>
          Zarezervovat termín {popis}? Použije se na něj jedna vaše zaplacená konzultace. Zrušit
          nebo přeložit ho můžete nejpozději 24 hodin předem.
        </>
      }
      potvrdit="Zarezervovat"
      akce={() => zarezervuj(slotId)}
    />
  );
}

export function ZruseniRezervace({ bookingId, kdy }: { bookingId: string; kdy: string }) {
  return (
    <OknoAkce
      tlacitko="Zrušit"
      titulek="Zrušit rezervaci"
      popis={
        <>
          Opravdu zrušit konzultaci {kdy}? Konzultace vám zůstane a můžete si vybrat jiný termín.
          Tenhle termín si ale mezitím může vzít někdo jiný.{" "}
          <strong>Tuhle akci nelze vzít zpět.</strong>
        </>
      }
      potvrdit="Zrušit rezervaci"
      nebezpecne
      zpet="Ponechat"
      akce={() => zrus(bookingId)}
    />
  );
}

export function PrelozeniRezervace({
  bookingId,
  kdy,
  terminy,
}: {
  bookingId: string;
  kdy: string;
  terminy: { id: string; popis: string }[];
}) {
  const [vybrany, setVybrany] = useState<string | null>(null);

  if (terminy.length === 0) return null;

  return (
    <OknoAkce
      tlacitko="Přeložit"
      titulek="Přeložit konzultaci"
      popis={<>Vyberte nový termín místo {kdy}. Původní termín se uvolní.</>}
      potvrdit="Přeložit"
      obsah={
        <fieldset className="max-h-64 space-y-1 overflow-y-auto">
          <legend className="sr-only">Nový termín</legend>
          {terminy.map((t) => (
            <label key={t.id} className="flex items-center gap-2 py-1 text-sm tabular-nums">
              <input
                type="radio"
                name={`novy-termin-${bookingId}`}
                value={t.id}
                checked={vybrany === t.id}
                onChange={() => setVybrany(t.id)}
                className="accent-primary size-4 shrink-0"
              />
              {t.popis}
            </label>
          ))}
        </fieldset>
      }
      akce={() => (vybrany ? preloz(bookingId, vybrany) : null)}
    />
  );
}
