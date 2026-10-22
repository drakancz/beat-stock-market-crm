"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, MessageSquare, Tag, TagsIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Stitek } from "@/components/stitky/stitek";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TagColor } from "@/generated/prisma/enums";
import { pocet } from "@/lib/mnozne";

import { nastavStitekKlientum } from "./stitky-actions";
import { posliZpravuVybranym } from "./zpravy-actions";

type StitekVolba = { id: string; name: string; color: TagColor };

/**
 * Lišta hromadných akcí nad vybranými klienty (Fáze 5B, Jakub 11. 10. 2026).
 *
 * - **Štítek přidat / odebrat** — každý přihlášený; okno řekne, kolika
 *   klientů se to týká. Odebrání je potvrzení mazání (CLAUDE.md).
 * - **Stáhnout do tabulky** — každý přihlášený (`klienti/export`).
 * - **Poslat zprávu** — jen administrátor, jen klientům s účtem.
 *
 * Skrytí tlačítek je úklid; rozhodují serverové akce.
 */
export function HromadneAkce({
  vybrane,
  stitky,
  jeAdmin,
  zrusitVyber,
}: {
  vybrane: string[];
  stitky: StitekVolba[];
  jeAdmin: boolean;
  zrusitVyber: () => void;
}) {
  const router = useRouter();
  const [okno, setOkno] = useState<"pridat" | "odebrat" | "zprava" | null>(null);
  const [stitekId, setStitekId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  const kolik = pocet(vybrane.length, "klient", "klienti", "klientů");
  const komu = pocet(vybrane.length, "klientovi", "klientům", "klientům");
  const stitek = stitky.find((s) => s.id === stitekId);

  function otevri(druh: "pridat" | "odebrat" | "zprava") {
    setChyba(null);
    setStitekId(null);
    setOkno(druh);
  }

  function hotovo(vysledek: { ok: true; zprava: string } | { ok: false; chyba: string }) {
    if (!vysledek.ok) {
      setChyba(vysledek.chyba);
      return;
    }
    toast.success(vysledek.zprava);
    setOkno(null);
    setText("");
    router.refresh();
  }

  return (
    <div
      role="toolbar"
      aria-label="Hromadné akce"
      className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
    >
      <span className="text-sm font-medium">Vybráno: {kolik}</span>
      <Button variant="ghost" size="sm" onClick={zrusitVyber}>
        <X />
        Zrušit výběr
      </Button>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        {stitky.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => otevri("pridat")}>
              <Tag />
              Přidat štítek
            </Button>
            <Button variant="outline" size="sm" onClick={() => otevri("odebrat")}>
              <TagsIcon />
              Odebrat štítek
            </Button>
          </>
        )}
        {/* Formulář, ne `fetch` — prohlížeč soubor rovnou stáhne. */}
        <form method="post" action="/klienti/export">
          {vybrane.map((id) => (
            <input key={id} type="hidden" name="id" value={id} />
          ))}
          <Button type="submit" variant="outline" size="sm">
            <Download />
            Stáhnout do tabulky
          </Button>
        </form>
        {jeAdmin && (
          <Button variant="outline" size="sm" onClick={() => otevri("zprava")}>
            <MessageSquare />
            Poslat zprávu
          </Button>
        )}
      </div>

      <Dialog open={okno === "pridat" || okno === "odebrat"} onOpenChange={() => setOkno(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{okno === "odebrat" ? "Odebrat štítek" : "Přidat štítek"}</DialogTitle>
            <DialogDescription>
              {okno === "odebrat" ? (
                <>
                  Vybraný štítek zmizí u {pocet(vybrane.length, "klienta", "klientů", "klientů")},
                  kteří ho mají. <strong>Tuhle akci nelze vzít zpět</strong> — vrátit štítek jde jen
                  novým přidáním.
                </>
              ) : (
                <>Štítek se přidá všem vybraným ({kolik}). Kdo ho už má, zůstane beze změny.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          <div role="radiogroup" aria-label="Štítek" className="flex flex-wrap gap-2">
            {stitky.map((volba) => (
              <label key={volba.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="hromadny-stitek"
                  checked={stitekId === volba.id}
                  onChange={() => setStitekId(volba.id)}
                  aria-label={volba.name}
                  className="accent-primary size-4"
                />
                <Stitek nazev={volba.name} barva={volba.color} />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOkno(null)}>
              Zrušit
            </Button>
            <Button
              variant={okno === "odebrat" ? "destructive" : "default"}
              disabled={!stitek || ceka}
              onClick={() =>
                zahaj(async () => {
                  setChyba(null);
                  hotovo(await nastavStitekKlientum(vybrane, stitekId!, okno === "pridat"));
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              {stitek
                ? okno === "odebrat"
                  ? `Odebrat ${stitek.name} (${kolik})`
                  : `Přidat ${stitek.name} ${komu}`
                : "Vyber štítek"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={okno === "zprava"} onOpenChange={() => setOkno(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Poslat zprávu vybraným</DialogTitle>
            <DialogDescription>
              Každý z vybraných, kdo má účet v klientské části, dostane zprávu do sekce Zprávy a
              oznámení (jinak e-mail). Ostatní se přeskočí. Hromadné kampaně patří do SmartEmailingu
              — tohle je na krátké vzkazy. Nepiš citlivé údaje ani reklamu.
            </DialogDescription>
          </DialogHeader>
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="hromadna-zprava">Text zprávy</Label>
            <Textarea
              id="hromadna-zprava"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOkno(null)}>
              Zrušit
            </Button>
            <Button
              disabled={!text.trim() || ceka}
              onClick={() =>
                zahaj(async () => {
                  setChyba(null);
                  hotovo(await posliZpravuVybranym(vybrane, text));
                })
              }
            >
              {ceka && <Loader2 className="animate-spin" />}
              Poslat ({kolik})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
