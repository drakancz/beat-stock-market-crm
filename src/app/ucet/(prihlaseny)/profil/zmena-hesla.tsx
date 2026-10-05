"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { zmenHesloKlienta } from "./actions";

/** Stejně jako `MIN_DELKA_HESLA` v `src/lib/hesla.ts` (ten jde jen na server). */
const MIN_DELKA = 12;

export function ZmenaHeslaKlienta() {
  const router = useRouter();
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heslo</CardTitle>
        <CardDescription>
          Změna hesla odhlásí všechna zařízení včetně tohohle. Přihlásíte se hned znovu, už novým
          heslem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            zahaj(async () => {
              setChyba(null);
              const vysledek = await zmenHesloKlienta(formData);
              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }
              // Přihlášení už neplatí — rovnou na přihlášení s hláškou.
              router.push("/ucet/prihlaseni?heslo=zmeneno");
              router.refresh();
            })
          }
          className="max-w-sm space-y-4"
        >
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="stare">Současné heslo</Label>
            <Input
              id="stare"
              name="stare"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nove">Nové heslo</Label>
            <Input
              id="nove"
              name="nove"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_DELKA}
            />
            <p className="text-muted-foreground text-xs">Alespoň {MIN_DELKA} znaků.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="potvrzeni">Nové heslo ještě jednou</Label>
            <Input
              id="potvrzeni"
              name="potvrzeni"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_DELKA}
            />
          </div>

          <Button type="submit" disabled={ceka}>
            {ceka && <Loader2 className="animate-spin" />}
            Změnit heslo
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
