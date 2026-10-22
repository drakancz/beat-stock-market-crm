"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, Send, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CastOdpovedi } from "@/lib/asistent/prezdivky";
import { cn } from "@/lib/utils";

import { zeptejSeAsistenta } from "./actions";

/**
 * Okno rozhovoru s asistentem AI (krok 4). Rozhovor žije jen tady
 * v prohlížeči — po zavření nebo „Nový rozhovor“ zmizí; server ho
 * neukládá. Odpovědi asistenta se drží ve tvaru s přezdívkami, ať
 * se při další otázce neposílají jména.
 */

type Zprava =
  { role: "user"; text: string } | { role: "assistant"; text: string; casti: CastOdpovedi[] };

const UKAZKY = [
  "Kolik objednávek bylo tento měsíc zaplaceno a za kolik?",
  "Kterým klientům skončí členství v příštích 14 dnech?",
  "Kdo zaplatil a ještě nemá povolený přístup do programu?",
  "Ze kterého zdroje přišlo letos nejvíc klientů?",
];

export function Rozhovor({ zbyva: zbyvaNaZacatku, limit }: { zbyva: number; limit: number }) {
  const [zpravy, setZpravy] = useState<Zprava[]>([]);
  // Pole je bez stavu Reactu: text napsaný ještě před načtením skriptů
  // by jinak React při startu zahodil a tlačítko by zůstalo zamčené.
  const nastavOtazku = (text: string) => {
    if (pole.current) pole.current.value = text;
  };
  const [chyba, setChyba] = useState<string | null>(null);
  const [zbyva, setZbyva] = useState(zbyvaNaZacatku);
  const [ceka, startTransition] = useTransition();
  const pole = useRef<HTMLTextAreaElement>(null);

  function odesli() {
    const text = pole.current?.value.trim() ?? "";
    if (!text || ceka || zbyva === 0) return;
    const rozhovor: Zprava[] = [...zpravy, { role: "user", text }];
    setZpravy(rozhovor);
    nastavOtazku("");
    setChyba(null);

    startTransition(async () => {
      const vysledek = await zeptejSeAsistenta(
        rozhovor.map((zprava) => ({ role: zprava.role, text: zprava.text })),
      );
      if (vysledek.zbyva >= 0) setZbyva(vysledek.zbyva);
      if (vysledek.ok) {
        setZpravy([...rozhovor, { role: "assistant", text: vysledek.text, casti: vysledek.casti }]);
      } else {
        // Otázka se vrátí do pole, ať ji jde poslat znovu.
        setZpravy(zpravy);
        nastavOtazku(text);
        setChyba(vysledek.chyba);
      }
      pole.current?.focus();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="text-muted-foreground size-4 shrink-0" aria-hidden />
          Asistent AI
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            Ptej se na data v CRM — objednávky, tržby, členství, zdroje klientů. Jen čte, nic
            nemění. Rozhovor se nikam neukládá.
          </span>
          <span className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Klienti jdou k AI jen pod přezdívkou, bez kontaktů a poznámek. Neptej se proto jménem,
            e-mailem ani telefonem — jména ti v odpovědi doplní CRM.
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {zpravy.length === 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">Zkus třeba:</p>
            <ul className="flex flex-wrap gap-2">
              {UKAZKY.map((ukazka) => (
                <li key={ukazka}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto py-1.5 text-left whitespace-normal"
                    onClick={() => {
                      nastavOtazku(ukazka);
                      pole.current?.focus();
                    }}
                  >
                    {ukazka}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="space-y-3" aria-label="Rozhovor" aria-live="polite">
            {zpravy.map((zprava, index) => (
              <li
                key={index}
                className={cn(
                  "max-w-[90%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap",
                  zprava.role === "user"
                    ? "bg-primary text-primary-foreground ml-auto"
                    : "bg-muted mr-auto",
                )}
                data-role={zprava.role}
              >
                <span className="sr-only">{zprava.role === "user" ? "Ty: " : "Asistent: "}</span>
                {zprava.role === "user" ? zprava.text : <Odpoved casti={zprava.casti} />}
              </li>
            ))}
            {ceka && (
              <li className="bg-muted text-muted-foreground mr-auto rounded-lg px-3 py-2 text-sm">
                Přemýšlím…
              </li>
            )}
          </ol>
        )}

        {chyba && (
          <Alert variant="destructive">
            <AlertDescription>{chyba}</AlertDescription>
          </Alert>
        )}

        <form
          className="space-y-2"
          onSubmit={(udalost) => {
            udalost.preventDefault();
            odesli();
          }}
        >
          <Label htmlFor="otazka-asistent">Tvoje otázka</Label>
          <Textarea
            id="otazka-asistent"
            ref={pole}
            defaultValue=""
            maxLength={4000}
            rows={3}
            disabled={zbyva === 0}
            onKeyDown={(udalost) => {
              // Enter odešle, Shift+Enter dělá nový řádek.
              if (
                udalost.key === "Enter" &&
                !udalost.shiftKey &&
                !udalost.nativeEvent.isComposing
              ) {
                udalost.preventDefault();
                odesli();
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {zbyva === 0
                ? `Dnešní limit ${limit} otázek je vyčerpaný. Zítra zase.`
                : `Dnes zbývá ${zbyva} z ${limit} otázek.`}
            </p>
            <div className="flex gap-2">
              {zpravy.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={ceka}
                  onClick={() => {
                    setZpravy([]);
                    setChyba(null);
                  }}
                >
                  Nový rozhovor
                </Button>
              )}
              <Button type="submit" disabled={ceka || zbyva === 0}>
                <Send />
                Zeptat se
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Odpoved({ casti }: { casti: CastOdpovedi[] }) {
  return (
    <>
      {casti.map((cast, index) =>
        "text" in cast ? (
          <span key={index}>{cast.text}</span>
        ) : cast.klient.smazany ? (
          <span key={index} className="font-medium">
            {cast.klient.name} (ve Smazaných)
          </span>
        ) : (
          <Link
            key={index}
            href={`/klienti/${cast.klient.id}`}
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            {cast.klient.name}
          </Link>
        ),
      )}
    </>
  );
}
