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
import { CLIENT_STAGES } from "@/lib/types";
import type { ClientStage } from "@/generated/prisma/enums";

import { upravKlienta, zalozKlienta } from "./actions";

/** Zdroj klienta k výběru. Seznam spravuje administrátor v Nastavení. */
export interface VolbaZdroje {
  id: string;
  name: string;
  /** Skrytý zdroj se nabízí jen klientovi, který ho už má. */
  active: boolean;
}

export interface KlientKUprave {
  id: string;
  name: string;
  /** E-mail je povinný, telefon ne (Jakub, 15. 9. 2026). */
  email: string;
  phone: string;
  /** Interní poznámka týmu. */
  sourceId: string;
  stage: ClientStage;
  souhlasMarketing: boolean;
}

/**
 * Formulář na klienta — stejný pro založení i úpravu.
 *
 * Co se tu jen zobrazuje, se **znovu ověřuje na serveru**.
 *
 * Výběr „Přiřazený obchodník" tu byl do 22. 9. 2026. Klienti se nikomu
 * nepřiřazují, takže zmizel i s pravidlem, kdo smí přiřazení měnit.
 *
 * Broker u klienta (výběr při založení, oddíl Brokeři v okně Upravit)
 * zmizel 20. 10. 2026 spolu s portfolii (Jakub). Co klient o brokerech
 * uvedl na webu, je dál na kartě jako „Broker podle klienta“.
 */
export function KlientDialog({
  zdroje,
  klient,
}: {
  zdroje: VolbaZdroje[];
  /** Když chybí, formulář zakládá nového klienta. */
  klient?: KlientKUprave;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  // React po odeslání formulář sám vyprázdní. Když ho server odmítne,
  // člověk by musel všechno psát znovu — proto si poslední vyplněné
  // hodnoty pamatujeme a formulář s nimi znovu složíme (`pokus` v `key`).
  const [zadane, setZadane] = useState<Record<string, string>>({});
  const [pokus, setPokus] = useState(0);

  const upravuje = klient !== undefined;

  /** Co má být v políčku: co člověk naposledy napsal, jinak uložená hodnota. */
  const hodnota = (klic: string, vychozi = "") =>
    zadane[klic] ?? ((klient as Record<string, unknown> | undefined)?.[klic] as string) ?? vychozi;

  /**
   * Souhlas s marketingem: „ano", „ne", nebo u nového klienta nic — volba
   * je povinná a nesmí být předvybraná (Jakub, 15. 9. 2026).
   */
  const souhlasMarketingu =
    pokus > 0
      ? zadane.souhlasMarketing
      : klient
        ? klient.souhlasMarketing
          ? "ano"
          : "ne"
        : undefined;

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) setChyba(null);
      }}
    >
      <Button variant={upravuje ? "outline" : "default"} onClick={() => setOtevreno(true)}>
        {upravuje ? <Pencil /> : <Plus />}
        {upravuje ? "Upravit" : "Nový klient"}
      </Button>

      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          key={pokus}
          action={(formData) =>
            zahaj(async () => {
              setChyba(null);

              const vysledek = upravuje
                ? await upravKlienta(klient.id, formData)
                : await zalozKlienta(formData);

              if (!vysledek.ok) {
                // Hláška se ukáže dvakrát: v dialogu u formuláře a jako
                // upozornění v rohu. Samotný text v dialogu se dá snadno
                // přehlédnout a člověk pak neví, proč se nic nestalo.
                setChyba(vysledek.chyba);
                toast.error(vysledek.chyba);

                // Vrátit člověku, co napsal — jinak by po odmítnutí koukal
                // na prázdný formulář.
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

              // Po založení rovnou na kartu nového klienta.
              if (!upravuje && vysledek.id) router.push(`/klienti/${vysledek.id}`);
            })
          }
        >
          <DialogHeader>
            <DialogTitle>{upravuje ? "Upravit klienta" : "Nový klient"}</DialogTitle>
            <DialogDescription>
              {upravuje
                ? "Změny se zapíšou do auditního logu — bude z něj vidět, kdo co změnil."
                : "Souhlasy se evidují s datem. Vyplň je podle toho, co klient skutečně řekl."}
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Jméno a příjmení</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={120}
                autoComplete="off"
                defaultValue={hodnota("name")}
              />
            </div>

            {/* E-mail povinný, mobil nepovinný (Jakub, 15. 9. 2026). Povinnost
                si hlídá i server a samotná databáze. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">
                  E-mail <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                  defaultValue={hodnota("email")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">
                  Mobilní telefon{" "}
                  <span className="text-muted-foreground font-normal">(nepovinné)</span>
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  maxLength={24}
                  autoComplete="off"
                  placeholder="+420 601 234 567"
                  defaultValue={hodnota("phone")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sourceId">Odkud o nás ví</Label>
              <Select name="sourceId" defaultValue={hodnota("sourceId")} required>
                <SelectTrigger id="sourceId" className="w-full">
                  <SelectValue placeholder="Vyber zdroj" />
                </SelectTrigger>
                <SelectContent>
                  {zdroje
                    .filter((zdroj) => zdroj.active || zdroj.id === klient?.sourceId)
                    .map((zdroj) => (
                      <SelectItem key={zdroj.id} value={zdroj.id}>
                        {zdroj.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Seznam zdrojů spravuje administrátor v Nastavení.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stage">Stav</Label>
                <Select name="stage" defaultValue={hodnota("stage", "NOVY")}>
                  <SelectTrigger id="stage" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_STAGES.map((stav) => (
                      <SelectItem key={stav.id} value={stav.id}>
                        {stav.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Souhlasy</legend>

              {/* Dvě volby místo zaškrtávacího políčka: nezaškrtnuté políčko
                  nešlo odlišit od přehlédnutého. Výběr hlídá i server. */}
              <div
                role="radiogroup"
                aria-labelledby="souhlasMarketing-popisek"
                aria-required="true"
                className="space-y-2"
              >
                <p id="souhlasMarketing-popisek" className="text-sm leading-relaxed">
                  Souhlas s marketingovým sdělením <span className="text-destructive">*</span>
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {(
                    [
                      ["ano", "Souhlasí"],
                      ["ne", "Nesouhlasí"],
                    ] as const
                  ).map(([volba, popisek]) => (
                    <label key={volba} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="souhlasMarketing"
                        value={volba}
                        required
                        defaultChecked={souhlasMarketingu === volba}
                        className="accent-primary size-4"
                      />
                      {popisek}
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-muted-foreground text-xs leading-relaxed">
                Souhlas s marketingem je potřeba vždy vybrat. Bez zaznamenaného souhlasu systém
                neodešle marketingové sdělení. Datum se ukládá k okamžiku udělení souhlasu.
              </p>
            </fieldset>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              {upravuje ? "Uložit změny" : "Založit klienta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
