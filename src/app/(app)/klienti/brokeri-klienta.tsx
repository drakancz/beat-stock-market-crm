"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Unlink } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { odeberBrokera, pridejBrokera } from "./actions";
import { PoleBrokera } from "./pole-brokera";
import type { VolbaBrokera } from "./vyber-brokera";

const MENY = ["CZK", "EUR", "USD"] as const;

/** Broker, u kterého klient portfolio má. */
export interface BrokerKlienta {
  portfolioId: string;
  nazev: string;
  mena: string;
}

/**
 * Oddíl Brokeři ve formuláři Upravit (Jakub, 25. 9. 2026).
 *
 * Do 23. 9. 2026 se brokeři klientovi přidávali a odebírali v záložce
 * Portfolia na kartě, která zmizela — a s ní i jediná cesta, jak omylem
 * přiřazeného brokera odebrat. **Smí to každý přihlášený**, stejně jako
 * výběr brokera při zakládání klienta.
 *
 * Změny se ukládají hned, ne tlačítkem Uložit změny: oddíl má vlastní
 * formulář a leží v okně pod tím hlavním (vnořený formulář HTML nedovolí).
 */
export function BrokeriKlienta({
  klientId,
  klientJmeno,
  brokeri,
  volni,
}: {
  klientId: string;
  klientJmeno: string;
  /** U koho klient portfolio má. */
  brokeri: BrokerKlienta[];
  /** Brokeři, které klient ještě nemá — nabízejí se k přidání. */
  volni: VolbaBrokera[];
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  // Po přidání se výběr vyprázdní — `key` složí pole brokera znovu.
  const [pokus, setPokus] = useState(0);

  return (
    <section aria-labelledby="brokeri-klienta" className="mt-6 space-y-3 border-t pt-5">
      <div>
        <h3 id="brokeri-klienta" className="text-base">
          Brokeři
        </h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          U koho má klient účet. Přidání i odebrání se uloží hned, bez tlačítka Uložit změny.
        </p>
      </div>

      {brokeri.length === 0 ? (
        <p className="text-muted-foreground text-sm">Klient zatím u žádného brokera není.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {brokeri.map((broker) => (
            <li
              key={broker.portfolioId}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {broker.nazev}{" "}
                <span className="text-muted-foreground font-mono text-xs">{broker.mena}</span>
              </span>
              <OdebratBrokera
                portfolioId={broker.portfolioId}
                brokerName={broker.nazev}
                klientJmeno={klientJmeno}
              />
            </li>
          ))}
        </ul>
      )}

      {volni.length > 0 ? (
        <form
          key={pokus}
          className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
          action={(formData) =>
            zahaj(async () => {
              const vysledek = await pridejBrokera(klientId, formData);

              if (!vysledek.ok) {
                toast.error(vysledek.chyba);
                return;
              }

              toast.success(vysledek.zprava);
              setPokus((cislo) => cislo + 1);
              router.refresh();
            })
          }
        >
          <div className="min-w-0 space-y-2">
            <p className="text-sm leading-none font-medium">Přidat brokera</p>
            <PoleBrokera brokeri={volni} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pridatMenu">Měna</Label>
            <Select name="currency" defaultValue="CZK">
              <SelectTrigger id="pridatMenu" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MENY.map((mena) => (
                  <SelectItem key={mena} value={mena}>
                    {mena}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={ceka}>
            {ceka ? <Loader2 className="animate-spin" /> : <Plus />}
            Přidat
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-xs">
          Klient je u všech brokerů ze seznamu. Nové brokery zakládá administrátor.
        </p>
      )}
    </section>
  );
}

/**
 * Odebrání brokera klientovi.
 *
 * Potvrzovací okno jako u každé mazací akce (CLAUDE.md). Text mluví
 * o nevratném odebrání, i když administrátor záznam ze Smazaných umí
 * vrátit — uživatel má rozhodovat s vědomím, že je to napořád.
 */
function OdebratBrokera({
  portfolioId,
  brokerName,
  klientJmeno,
}: {
  portfolioId: string;
  brokerName: string;
  klientJmeno: string;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOtevreno(true)}
        aria-label={`Odebrat brokera ${brokerName}`}
      >
        <Unlink />
        Odebrat
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odebrat brokera</DialogTitle>
            <DialogDescription>
              Opravdu odebrat brokera {brokerName} u klienta {klientJmeno}? Klient zmizí ze seznamu
              u tohohle brokera. <strong>Tuhle akci nelze vzít zpět.</strong>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await odeberBrokera(portfolioId);

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
              Odebrat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
