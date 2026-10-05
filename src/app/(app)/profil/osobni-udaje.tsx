"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { patyPad } from "@/lib/osloveni";

import { ulozOsobniUdaje } from "./actions";

export interface OsobniUdajeData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  /** Uložené oslovení; prázdné = navrhne se z křestního jména. */
  vocative: string | null;
}

/**
 * Osobní údaje v profilu — ve Mém profilu i v profilu kolegy u
 * administrátora. Kdo smí co uložit, rozhoduje serverová akce.
 *
 * **Oslovení se navrhuje samo** z křestního jména (Jakub → Jakube).
 * Dokud ho člověk nepřepíše, mění se s jménem; jakmile ho přepíše,
 * zůstane jeho.
 */
export function OsobniUdaje({ udaje, vlastni }: { udaje: OsobniUdajeData; vlastni: boolean }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  // Hodnoty žijí ve stavu — po odmítnutí ze serveru se napsané neztratí.
  const [jmeno, setJmeno] = useState(udaje.firstName);
  const [osloveni, setOsloveni] = useState(udaje.vocative ?? patyPad(udaje.firstName));
  const [prepsane, setPrepsane] = useState(udaje.vocative !== null);

  const navrh = patyPad(jmeno);

  return (
    // `method="post"` jako u přihlášení (26. 9. 2026): kdyby se formulář
    // odeslal dřív, než se stránka v telefonu rozběhne, prohlížeč by ho
    // poslal postaru — bez metody by jméno a telefon skončily v adrese
    // a v historii prohlížeče. U `onSubmit` se metoda uvést smí.
    <form
      method="post"
      className="space-y-4"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — React by po odeslání formulář vyprázdnil.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozOsobniUdaje(udaje.userId, data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava ?? "Uloženo.");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Jméno</Label>
          <Input
            id="firstName"
            name="firstName"
            value={jmeno}
            onChange={(udalost) => {
              setJmeno(udalost.target.value);
              if (!prepsane) setOsloveni(patyPad(udalost.target.value));
            }}
            maxLength={60}
            autoComplete="given-name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Příjmení</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={udaje.lastName}
            maxLength={60}
            autoComplete="family-name"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Telefon</Label>
          {/* `key` podle uloženého čísla: po uložení se pole obnoví na tvar
              ze serveru (`+420 601 234 567`), ne na to, co kdo napsal.
              Po odmítnutí se číslo nezmění, takže napsané zůstane. */}
          <Input
            key={udaje.phone ?? ""}
            id="phone"
            name="phone"
            type="tel"
            defaultValue={udaje.phone ?? ""}
            maxLength={24}
            placeholder="+420 601 234 567"
            autoComplete="tel"
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Nepovinný. Vidí ho jen {vlastni ? "ty a " : "majitel profilu a "}administrátor.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="vocative">Oslovení (5. pád)</Label>
          <Input
            id="vocative"
            name="vocative"
            value={osloveni}
            onChange={(udalost) => {
              setOsloveni(udalost.target.value);
              setPrepsane(true);
            }}
            maxLength={60}
            autoComplete="off"
            placeholder={navrh}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            V e-mailech: „Ahoj {osloveni.trim() || navrh}“.{" "}
            {osloveni.trim() !== navrh && navrh && (
              <button
                type="button"
                className="text-foreground underline underline-offset-4"
                onClick={() => {
                  setOsloveni(navrh);
                  setPrepsane(false);
                }}
              >
                Použít návrh „{navrh}“
              </button>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-profilu">E-mail</Label>
        <Input id="email-profilu" value={udaje.email} disabled readOnly />
        <p className="text-muted-foreground text-xs leading-relaxed">
          E-mail je přihlašovací jméno a tady se nemění.
        </p>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit profil
      </Button>
    </form>
  );
}
