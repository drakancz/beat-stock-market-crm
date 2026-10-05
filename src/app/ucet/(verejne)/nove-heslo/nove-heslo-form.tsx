"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { nastavitHesloKlienta } from "./actions";

/** Stejně jako `MIN_DELKA_HESLA` v `src/lib/hesla.ts` (ten jde jen na server). */
const MIN_DELKA = 12;

export function NoveHesloKlientaForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  const [chyba, setChyba] = useState<string | null>(null);
  const [hotovo, setHotovo] = useState<{ prihlasen: boolean } | null>(null);
  const [ceka, zahaj] = useTransition();

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            Odkaz je neúplný nebo už neplatí. Napište nám prosím o nový.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/ucet/prihlaseni">Zpět na přihlášení</Link>
        </Button>
      </div>
    );
  }

  if (hotovo) {
    return (
      <div className="space-y-4">
        <Alert>
          <CheckCircle2 />
          <AlertDescription>
            {hotovo.prihlasen
              ? "Heslo je nastavené a jste přihlášeni."
              : "Heslo je nastavené. Můžete se přihlásit."}
          </AlertDescription>
        </Alert>
        <Button
          className="w-full"
          onClick={() => {
            router.push(hotovo.prihlasen ? "/ucet" : "/ucet/prihlaseni");
            router.refresh();
          }}
        >
          {hotovo.prihlasen ? "Pokračovat do klientské části" : "Přejít na přihlášení"}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        zahaj(async () => {
          setChyba(null);
          const heslo = String(formData.get("heslo") ?? "");

          // Jen zdvořilost — skutečné ověření dělá server.
          if (heslo.length < MIN_DELKA) {
            setChyba(`Heslo musí mít alespoň ${MIN_DELKA} znaků.`);
            return;
          }
          if (heslo !== String(formData.get("potvrzeni") ?? "")) {
            setChyba("Hesla se neshodují.");
            return;
          }

          const vysledek = await nastavitHesloKlienta(formData);
          if (!vysledek.ok) {
            setChyba(vysledek.chyba);
            return;
          }
          setHotovo({ prihlasen: vysledek.prihlasen });
        })
      }
      className="space-y-4"
    >
      <input type="hidden" name="token" value={token} />

      {chyba && (
        <Alert variant="destructive">
          <AlertDescription>{chyba}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="heslo">Nové heslo</Label>
        <Input
          id="heslo"
          name="heslo"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={MIN_DELKA}
        />
        <p className="text-muted-foreground text-xs">
          Alespoň {MIN_DELKA} znaků. Delší heslo z několika běžných slov je bezpečnější než krátké
          se zavináči.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="potvrzeni">Heslo ještě jednou</Label>
        <Input
          id="potvrzeni"
          name="potvrzeni"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_DELKA}
        />
      </div>

      <Button type="submit" className="w-full" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Nastavit heslo
      </Button>
    </form>
  );
}
