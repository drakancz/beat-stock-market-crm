"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Merge, UserX } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDatum } from "@/lib/format";
import { pocet } from "@/lib/mnozne";

import { oznacitNejsouDuplicita, sloucitKlienty } from "../duplicity-actions";

interface Klient {
  id: string;
  name: string;
  /** ISO — z serveru přichází jako text. */
  createdAt: string;
  pocetObjednavek: number;
}

export interface Dvojice {
  a: Klient;
  b: Klient;
  duvody: ("telefon" | "jmeno")[];
}

const POPIS_DUVODU = { telefon: "stejný telefon", jmeno: "stejné jméno" } as const;

const klicDvojice = (dvojice: Dvojice) => `${dvojice.a.id}:${dvojice.b.id}`;

/**
 * Seznam možných duplicit s tlačítky (Jakub, 27. 9. 2026).
 *
 * „Nejsou stejný člověk“ vidí každý, „Sloučit“ jen administrátor. Obojí
 * je jen pohodlí — oprávnění hlídají serverové akce.
 */
export function SeznamDuplicit({ dvojice, jeAdmin }: { dvojice: Dvojice[]; jeAdmin: boolean }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [probiha, setProbiha] = useState<string | null>(null);
  const [slouceni, setSlouceni] = useState<Dvojice | null>(null);

  return (
    <>
      <ul className="space-y-3">
        {dvojice.map((polozka) => (
          <li
            key={klicDvojice(polozka)}
            className="space-y-3 rounded-lg border p-4"
            aria-label={`${polozka.a.name} a ${polozka.b.name}`}
          >
            <div className="flex flex-wrap gap-1.5">
              {polozka.duvody.map((duvod) => (
                <Badge key={duvod} variant="secondary">
                  {POPIS_DUVODU[duvod]}
                </Badge>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[polozka.a, polozka.b].map((klient) => (
                <div key={klient.id} className="bg-muted/40 min-w-0 rounded-md px-3 py-2">
                  <Link
                    href={`/klienti/${klient.id}`}
                    className="block truncate font-medium underline-offset-4 hover:underline"
                  >
                    {klient.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    V systému od {formatDatum(new Date(klient.createdAt))} ·{" "}
                    {pocet(klient.pocetObjednavek, "objednávka", "objednávky", "objednávek")}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={ceka && probiha === klicDvojice(polozka)}
                onClick={() =>
                  zahaj(async () => {
                    setProbiha(klicDvojice(polozka));
                    const vysledek = await oznacitNejsouDuplicita(polozka.a.id, polozka.b.id);
                    if (!vysledek.ok) {
                      toast.error(vysledek.chyba);
                      return;
                    }
                    toast.success(vysledek.zprava);
                    router.refresh();
                  })
                }
              >
                {ceka && probiha === klicDvojice(polozka) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <UserX />
                )}
                Nejsou stejný člověk
              </Button>
              {jeAdmin && (
                <Button size="sm" onClick={() => setSlouceni(polozka)}>
                  <Merge />
                  Sloučit
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {jeAdmin && (
        <SlouceniDialog
          dvojice={slouceni}
          zavrit={() => setSlouceni(null)}
          hotovo={() => {
            setSlouceni(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Potvrzení sloučení. **Každá akce, která něco maže, má potvrzovací okno**
 * (CLAUDE.md) — sloučená karta jde do Smazaných a vrátit ji nejde.
 *
 * Předvybraná je karta s víc objednávkami, při shodě ta starší — tam je
 * víc historie. Administrátor to může přepnout.
 */
export function SlouceniDialog({
  dvojice,
  zavrit,
  hotovo,
}: {
  dvojice: Dvojice | null;
  zavrit: () => void;
  hotovo: () => void;
}) {
  const [ceka, zahaj] = useTransition();
  const [zustavaId, setZustavaId] = useState<string | null>(null);

  const vychozi = dvojice ? vychoziZustava(dvojice) : null;
  const zustava =
    dvojice && zustavaId
      ? ([dvojice.a, dvojice.b].find((klient) => klient.id === zustavaId) ?? vychozi)
      : vychozi;
  const odchazi = dvojice && zustava ? (zustava.id === dvojice.a.id ? dvojice.b : dvojice.a) : null;

  return (
    <Dialog
      open={dvojice !== null}
      onOpenChange={(stav) => {
        if (!stav) {
          setZustavaId(null);
          zavrit();
        }
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sloučit dvě karty klienta</DialogTitle>
          <DialogDescription>
            Vyber kartu, která zůstane. Z druhé se na ni přesunou objednávky, poznámky, úkoly,
            přílohy, brokeři i platnost členství. <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        {dvojice && zustava && odchazi && (
          <div className="my-4 space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Která karta zůstane</legend>
              {[dvojice.a, dvojice.b].map((klient) => (
                <label
                  key={klient.id}
                  className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="zustava"
                    value={klient.id}
                    checked={zustava.id === klient.id}
                    onChange={() => setZustavaId(klient.id)}
                    className="accent-primary mt-0.5 size-4"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{klient.name}</span>
                    <span className="text-muted-foreground text-xs">
                      V systému od {formatDatum(new Date(klient.createdAt))} ·{" "}
                      {pocet(klient.pocetObjednavek, "objednávka", "objednávky", "objednávek")}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Alert>
              <AlertDescription className="text-xs leading-relaxed">
                Zůstane karta <strong>{zustava.name}</strong> se svým jménem a e-mailem. Karta{" "}
                <strong>{odchazi.name}</strong> půjde do Smazaných a vrátit ji nepůjde. Chybějící
                telefon se doplní z druhé karty, souhlas s marketingem platí ten novější a přístup
                do programu zůstane povolený, když ho měla aspoň jedna karta. Objednávka nebo zpráva
                z webu s e-mailem sloučené karty se zapíše sem.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={zavrit}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka || !zustava || !odchazi}
            onClick={() =>
              zustava &&
              odchazi &&
              zahaj(async () => {
                const vysledek = await sloucitKlienty(zustava.id, odchazi.id);
                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                  toast.error(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setZustavaId(null);
                hotovo();
              })
            }
          >
            {ceka && <Loader2 className="animate-spin" />}
            Sloučit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function vychoziZustava(dvojice: Dvojice): Klient {
  const { a, b } = dvojice;
  if (a.pocetObjednavek !== b.pocetObjednavek) {
    return a.pocetObjednavek > b.pocetObjednavek ? a : b;
  }
  return a.createdAt <= b.createdAt ? a : b;
}
