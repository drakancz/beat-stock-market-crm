"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ulozUdajeKlienta } from "./actions";

/** Jméno, telefon a souhlas se zasíláním novinek. E-mail jen k nahlédnutí. */
export function UdajeKlienta({
  udaje,
}: {
  udaje: { name: string; email: string; phone: string; souhlas: boolean };
}) {
  const router = useRouter();
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Moje údaje</CardTitle>
        <CardDescription>
          E-mail je vaše přihlašovací jméno. Když ho potřebujete změnit, napište nám.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            zahaj(async () => {
              setChyba(null);
              const vysledek = await ulozUdajeKlienta(formData);
              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }
              toast.success(vysledek.zprava ?? "Uloženo.");
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
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" value={udaje.email} readOnly disabled />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Jméno a příjmení</Label>
            <Input
              id="name"
              name="name"
              defaultValue={udaje.name}
              autoComplete="name"
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefon (nepovinné)</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={udaje.phone}
              autoComplete="tel"
              placeholder="+420 601 234 567"
              maxLength={24}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Zasílání novinek e-mailem</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="souhlas"
                value="ano"
                defaultChecked={udaje.souhlas}
                required
              />
              Souhlasím
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="souhlas" value="ne" defaultChecked={!udaje.souhlas} />
              Nesouhlasím
            </label>
          </fieldset>

          <Button type="submit" disabled={ceka}>
            {ceka && <Loader2 className="animate-spin" />}
            Uložit údaje
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
