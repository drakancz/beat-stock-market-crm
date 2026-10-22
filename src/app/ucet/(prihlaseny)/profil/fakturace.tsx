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

import { ulozFakturacniUdaje } from "./actions";

export interface Fakturace {
  nazev: string;
  ulice: string;
  mesto: string;
  psc: string;
  zeme: string;
  ico: string;
  dic: string;
}

const POLE: { klic: keyof Fakturace; popisek: string; napoveda?: string; sirka?: string }[] = [
  { klic: "nazev", popisek: "Jméno nebo firma", napoveda: "Prázdné = vaše jméno." },
  { klic: "ulice", popisek: "Ulice a číslo" },
  { klic: "mesto", popisek: "Město" },
  { klic: "psc", popisek: "PSČ", sirka: "max-w-32" },
  { klic: "zeme", popisek: "Země", napoveda: "Kód země, třeba CZ.", sirka: "max-w-20" },
  { klic: "ico", popisek: "IČO (nepovinné)", sirka: "max-w-40" },
  { klic: "dic", popisek: "DIČ (nepovinné)", sirka: "max-w-40" },
];

/**
 * Fakturační údaje (19. 10. 2026) — nepovinné. Bez adresy dostanete
 * zjednodušený daňový doklad; vystavené faktury se změnou nepřepíšou.
 */
export function FakturacniUdaje({ udaje }: { udaje: Fakturace }) {
  const router = useRouter();
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fakturační údaje</CardTitle>
        <CardDescription>
          Nepovinné. Uvedou se na fakturách, které vystavíme po dalších platbách.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(udalost) => {
            udalost.preventDefault();
            const formData = new FormData(udalost.currentTarget);
            zahaj(async () => {
              setChyba(null);
              const vysledek = await ulozFakturacniUdaje(formData);
              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }
              toast.success(vysledek.zprava ?? "Uloženo.");
              router.refresh();
            });
          }}
          className="max-w-sm space-y-4"
        >
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          {POLE.map((pole) => (
            <div key={pole.klic} className="space-y-2">
              <Label htmlFor={`fakturace-${pole.klic}`}>{pole.popisek}</Label>
              <Input
                id={`fakturace-${pole.klic}`}
                name={pole.klic}
                defaultValue={udaje[pole.klic]}
                className={pole.sirka}
                maxLength={200}
              />
              {pole.napoveda && <p className="text-muted-foreground text-xs">{pole.napoveda}</p>}
            </div>
          ))}
          <Button type="submit" disabled={ceka}>
            {ceka && <Loader2 className="animate-spin" />}
            Uložit fakturační údaje
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
