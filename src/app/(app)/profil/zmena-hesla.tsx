"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOut } from "@/lib/auth-client";

import { zmenHeslo } from "./actions";

const MIN_DELKA = 12;

export function ZmenaHesla() {
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heslo</CardTitle>
        <CardDescription>
          Změna hesla odhlásí všechna zařízení včetně tohohle. Přihlásíš se hned znovu, už novým
          heslem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            zahaj(async () => {
              setChyba(null);

              const vysledek = await zmenHeslo(formData);

              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }

              // Vlastní přihlášení už neplatí, takže se odhlásíme rovnou —
              // jinak by uživatel zůstal na obrazovce, která mu při
              // prvním kliknutí stejně skončí na přihlášení.
              //
              // Hláška o změně se ukáže až na přihlášení (`?heslo=zmeneno`).
              // Upozornění v rohu tu bylo do 26. 9. 2026, jenže odhlášení
              // načte novou stránku a hlášku zahodilo dřív, než šla přečíst.
              await signOut({ callbackUrl: "/prihlaseni?heslo=zmeneno" });
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
