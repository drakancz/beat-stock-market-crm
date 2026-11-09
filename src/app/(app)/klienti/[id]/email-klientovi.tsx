"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Info, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_PREDMET,
  MAX_TEXT,
  POPIS_STAVU_EMAILU,
  doplnJmeno,
  type StavEmailu,
} from "@/lib/email-z-karty";

import { posliEmailKlientovi } from "../email-actions";

export interface SablonaKVyberu {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface EmailNaKarte {
  id: string;
  predmet: string;
  text: string;
  autor: string | null;
  kdy: string;
  stav: StavEmailu;
}

const BEZ_SABLONY = "bez-sablony";

/**
 * Tlačítko Poslat email a jeho okno na kartě klienta (Fáze 5D, Jakub
 * 5. 11. 2026).
 *
 * **Poslat smí každý přihlášený**, kdo vidí kartu — akce
 * `posliEmailKlientovi()` si přihlášení i klienta ověří znovu. Šablony
 * jen předvyplní předmět a text, obojí jde před odesláním upravit.
 * Historii vidí každý, kdo vidí kartu.
 */
export function EmailKlientovi({
  klient,
  sablony,
  emaily,
}: {
  klient: { id: string; name: string; email: string; souhlasMarketing: boolean };
  sablony: SablonaKVyberu[];
  emaily: EmailNaKarte[];
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [sablonaId, setSablonaId] = useState(BEZ_SABLONY);
  const [predmet, setPredmet] = useState("");
  const [text, setText] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  function vyberSablonu(id: string) {
    setSablonaId(id);
    const sablona = sablony.find((s) => s.id === id);
    if (!sablona) return;
    setPredmet(doplnJmeno(sablona.subject, klient.name));
    setText(doplnJmeno(sablona.body, klient.name));
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOtevreno(true)}>
        <Mail />
        {emaily.length > 0 ? `Poslat email (${emaily.length})` : "Poslat email"}
      </Button>

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
              <Mail />
              Poslat email
            </DialogTitle>
            <DialogDescription>
              Osobní e-mail pro: {klient.name}. Odpověď klienta přijde na tvůj e-mail.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(udalost) => {
              udalost.preventDefault();
              zahaj(async () => {
                setChyba(null);
                const vysledek = await posliEmailKlientovi(klient.id, predmet, text);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  router.refresh();
                  return;
                }
                toast.success(vysledek.zprava);
                setPredmet("");
                setText("");
                setSablonaId(BEZ_SABLONY);
                setOtevreno(false);
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            {!klient.souhlasMarketing && (
              <Alert>
                <Info />
                <AlertDescription>
                  Klient nemá souhlas s marketingem. Osobní odpověď nebo domluvu poslat jde, nabídku
                  ani reklamu ne.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-muted-foreground text-sm">
              Komu: <span className="text-foreground break-all">{klient.email}</span>
            </p>

            {sablony.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="email-sablona">Šablona</Label>
                <Select value={sablonaId} onValueChange={vyberSablonu}>
                  <SelectTrigger id="email-sablona" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BEZ_SABLONY}>Bez šablony</SelectItem>
                    {sablony.map((sablona) => (
                      <SelectItem key={sablona.id} value={sablona.id}>
                        {sablona.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email-predmet">Předmět</Label>
              <Input
                id="email-predmet"
                value={predmet}
                onChange={(udalost) => setPredmet(udalost.target.value)}
                maxLength={MAX_PREDMET}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-text">Text</Label>
              <Textarea
                id="email-text"
                value={text}
                onChange={(udalost) => setText(udalost.target.value)}
                maxLength={MAX_TEXT}
                rows={10}
                required
                placeholder="Dobrý den, …"
              />
              <p className="text-muted-foreground text-xs">
                Odstavce oddělte prázdným řádkem. Podpis a údaje firmy se doplní samy. Klientům se
                vyká.
              </p>
            </div>

            <Button type="submit" disabled={ceka || predmet.trim() === "" || text.trim() === ""}>
              {ceka ? <Loader2 className="animate-spin" /> : <Send />}
              Odeslat
            </Button>
          </form>

          <section aria-labelledby="email-historie" className="space-y-3">
            <h3 id="email-historie" className="text-sm font-medium">
              Odeslané e-maily
            </h3>
            {emaily.length === 0 ? (
              <p className="text-muted-foreground text-sm">Klientovi zatím nikdo z karty nepsal.</p>
            ) : (
              <ul className="space-y-3">
                {emaily.map((email) => (
                  <li key={email.id} className="rounded-md border p-3">
                    <details>
                      <summary className="cursor-pointer text-sm font-medium break-words">
                        {email.predmet}
                      </summary>
                      <p className="mt-2 text-sm break-words whitespace-pre-line">{email.text}</p>
                    </details>
                    <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-1 text-xs">
                      {email.kdy} · {email.autor ?? "neznámý autor"} ·
                      {email.stav === "ODESLANO" ? (
                        <span>{POPIS_STAVU_EMAILU.ODESLANO}</span>
                      ) : (
                        <Badge variant="outline">{POPIS_STAVU_EMAILU.NEODESLANO}</Badge>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
