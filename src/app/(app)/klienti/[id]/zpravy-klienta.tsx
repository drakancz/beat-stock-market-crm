"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { posliZpravuKlientovi } from "../zpravy-actions";

export interface ZpravaNaKarte {
  id: string;
  text: string;
  autor: string | null;
  kdy: string;
  doruceni: string;
  precteno: string | null;
}

/**
 * Obsah okna Zprávy na kartě klienta (krok 3A, Jakub 4. 10. 2026).
 *
 * Historii vidí každý, kdo vidí kartu. Formulář dostane jen administrátor
 * u klienta s aktivním účtem — `muzePsat` počítá server a akce
 * `posliZpravuKlientovi()` si roli i účet ověří znovu.
 */
export function ZpravyKlienta({
  klientId,
  zpravy,
  muzePsat,
  upozorneniVypnuta,
}: {
  klientId: string;
  zpravy: ZpravaNaKarte[];
  muzePsat: boolean;
  upozorneniVypnuta: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <div className="space-y-5">
      {muzePsat && (
        <form
          onSubmit={(udalost) => {
            udalost.preventDefault();
            zahaj(async () => {
              setChyba(null);
              const vysledek = await posliZpravuKlientovi(klientId, text);
              if (!vysledek.ok) {
                setChyba(vysledek.chyba);
                return;
              }
              toast.success(vysledek.zprava);
              setText("");
              router.refresh();
            });
          }}
          className="space-y-3"
        >
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="zprava-text">Nová zpráva</Label>
            <Textarea
              id="zprava-text"
              value={text}
              onChange={(udalost) => setText(udalost.target.value)}
              maxLength={1000}
              rows={4}
              required
              placeholder="Dobrý den, …"
            />
            <p className="text-muted-foreground text-xs">
              Klient ji uvidí v klientské části a přijde mu oznámení, případně e-mail. Text se ukáže
              i na zamčené obrazovce telefonu — nepiš do něj citlivé údaje ani reklamu.
              {upozorneniVypnuta &&
                " Klient má upozornění vypnutá, zprávu uvidí jen po přihlášení."}
            </p>
          </div>
          <Button type="submit" disabled={ceka || text.trim() === ""}>
            {ceka ? <Loader2 className="animate-spin" /> : <Send />}
            Poslat zprávu
          </Button>
        </form>
      )}

      {zpravy.length === 0 ? (
        <p className="text-muted-foreground text-sm">Klient zatím žádnou zprávu nedostal.</p>
      ) : (
        <ul className="space-y-3">
          {zpravy.map((zprava) => (
            <li key={zprava.id} className="rounded-md border p-3">
              <p className="text-sm whitespace-pre-line">{zprava.text}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                {zprava.kdy} · {zprava.autor ?? "neznámý autor"} · {zprava.doruceni}
                {zprava.precteno ? ` · přečteno ${zprava.precteno}` : " · zatím nepřečteno"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
