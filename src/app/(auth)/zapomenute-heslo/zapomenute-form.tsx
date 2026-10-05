"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { pozadejOOdkaz } from "./actions";

export function ZapomenuteForm() {
  const [hotovo, setHotovo] = useState(false);
  const [ceka, zahaj] = useTransition();

  if (hotovo) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Pokud u nás taková adresa je, je na cestě odkaz na nastavení nového hesla. Platí jednu
            hodinu.
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-xs leading-relaxed">
          E-mail nepřišel? Podívej se i do nevyžádané pošty. Když nedorazí ani za pár minut, požádej
          administrátora — nový odkaz ti vygeneruje ve Správě. Poslat si ho odsud jde jen několikrát
          za hodinu.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/prihlaseni">Zpět na přihlášení</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        zahaj(async () => {
          await pozadejOOdkaz(formData);
          // Odpověď se schválně nerozlišuje. Kdyby formulář u neznámé
          // adresy řekl „takový uživatel neexistuje", šlo by jím zjišťovat,
          // kdo ve firmě pracuje.
          setHotovo(true);
        })
      }
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="jmeno@beatstockmarket.cz"
        />
      </div>

      <Button type="submit" className="w-full" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Poslat odkaz
      </Button>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/prihlaseni">Zpět na přihlášení</Link>
      </Button>
    </form>
  );
}
