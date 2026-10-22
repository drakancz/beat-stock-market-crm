"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { AUTO_CONNECT_LABEL } from "@/lib/types";
import type { BrokerAutoConnect } from "@/generated/prisma/enums";

import { upravBrokera, zalozBrokera } from "./actions";

export interface BrokerKUprave {
  id: string;
  name: string;
  autoConnect: BrokerAutoConnect;
  website: string | null;
  logo: string | null;
  note: string | null;
}

const MOZNOSTI: BrokerAutoConnect[] = ["ANO", "PRAVDEPODOBNE", "ZATIM_NE"];

/**
 * Formulář na brokera — stejný pro založení i úpravu.
 *
 * Do celé sekce Správa pustí jen administrátora rám (`sprava/layout.tsx`)
 * a serverové akce si oprávnění ověřují znovu. Že se tenhle dialog někomu
 * nezobrazí, se za ochranu nepočítá.
 */
export function BrokerDialog({ broker }: { broker?: BrokerKUprave }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  // React po odeslání formulář sám vyprázdní. Když ho server odmítne,
  // člověk by musel všechno psát znovu — proto si poslední vyplněné
  // hodnoty pamatujeme a formulář s nimi znovu složíme (`pokus` v `key`).
  const [zadane, setZadane] = useState<Record<string, string>>({});
  const [pokus, setPokus] = useState(0);

  const upravuje = broker !== undefined;

  /** Co má být v políčku: co člověk naposledy napsal, jinak uložená hodnota. */
  const hodnota = (klic: keyof BrokerKUprave, vychozi = "") =>
    zadane[klic] ?? (broker?.[klic] as string | null | undefined) ?? vychozi;

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) setChyba(null);
      }}
    >
      <Button
        variant={upravuje ? "ghost" : "default"}
        size={upravuje ? "sm" : "default"}
        onClick={() => setOtevreno(true)}
      >
        {upravuje ? <Pencil /> : <Plus />}
        {upravuje ? "Upravit" : "Nový broker"}
      </Button>

      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          key={pokus}
          action={(formData) =>
            zahaj(async () => {
              setChyba(null);

              const vysledek = upravuje
                ? await upravBrokera(broker.id, formData)
                : await zalozBrokera(formData);

              if (!vysledek.ok) {
                // Hláška se ukáže v dialogu i jako upozornění v rohu —
                // samotný text v dialogu se dá snadno přehlédnout.
                setChyba(vysledek.chyba);
                toast.error(vysledek.chyba);

                // Vrátit člověku, co napsal. Bez tohohle by po odmítnutí
                // koukal na prázdný formulář.
                setZadane(
                  Object.fromEntries(
                    [...formData.entries()].map(([klic, obsah]) => [klic, String(obsah)]),
                  ),
                );
                setPokus((cislo) => cislo + 1);
                return;
              }

              toast.success(vysledek.zprava);
              setZadane({});
              setOtevreno(false);
              router.refresh();
            })
          }
        >
          <DialogHeader>
            <DialogTitle>{upravuje ? "Upravit brokera" : "Nový broker"}</DialogTitle>
            <DialogDescription>
              Katalog brokerů, u kterých klienti investují. Přístup ke svému účtu si vkládá sám
              klient — sem žádný klíč nepatří.
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Název</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={80}
                autoComplete="off"
                placeholder="Interactive Brokers"
                defaultValue={hodnota("name")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="autoConnect">Automatické napojení</Label>
              <Select name="autoConnect" defaultValue={hodnota("autoConnect", "ZATIM_NE")}>
                <SelectTrigger id="autoConnect" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOZNOSTI.map((moznost) => (
                    <SelectItem key={moznost} value={moznost}>
                      {AUTO_CONNECT_LABEL[moznost]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Umí broker vydat klíč jen pro čtení? Jen informace pro tým.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Web</Label>
              <Input
                id="website"
                name="website"
                type="url"
                maxLength={200}
                autoComplete="off"
                placeholder="https://www.interactivebrokers.com"
                defaultValue={hodnota("website")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Odkaz na logo</Label>
              <Input
                id="logo"
                name="logo"
                type="url"
                maxLength={300}
                autoComplete="off"
                placeholder="https://…/logo.png"
                defaultValue={hodnota("logo")}
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Zatím se vkládá odkazem — nahrávání souborů přijde, až systém poběží na serveru s
                úložištěm. Bez loga se v seznamu ukáže zkratka z názvu.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Poznámka</Label>
              <Textarea
                id="note"
                name="note"
                rows={3}
                maxLength={500}
                placeholder="Kde klient najde vydání klíče, na co si dát pozor…"
                defaultValue={hodnota("note")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              {upravuje ? "Uložit změny" : "Přidat brokera"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
