"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { pozadatOOdkazKlienta } from "./actions";

export function ZapomenuteKlientaForm() {
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
          E-mail nepřišel? Podívejte se i do nevyžádané pošty. Když nedorazí ani za pár minut,
          napište nám.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/ucet/prihlaseni">Zpět na přihlášení</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        zahaj(async () => {
          await pozadatOOdkazKlienta(formData);
          // Odpověď se schválně nerozlišuje — formulářem nejde zjistit, kdo je náš klient.
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
          placeholder="vas@email.cz"
        />
      </div>

      <Button type="submit" className="w-full" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Poslat odkaz
      </Button>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/ucet/prihlaseni">Zpět na přihlášení</Link>
      </Button>
    </form>
  );
}
