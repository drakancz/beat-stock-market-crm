"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { formatDatumCas } from "@/lib/format";
import type { PoznamkaKZobrazeni } from "@/lib/queries";

import { pridejPoznamku, smazPoznamku, upravPoznamku } from "../poznamky-actions";

/** Stejný strop jako v serverové akci — pole víc nepustí. */
const MAX_DELKA = 5000;

/**
 * Obsah okna Poznámky na kartě klienta (Jakub, 23. 9. 2026).
 *
 * Nahoře pole pro nový zápis, pod ním zápisy od nejnovějšího s autorem
 * a časem. Opravit a smazat se nabízí jen u vlastních zápisů, správci
 * u všech — **tlačítko ale nic nechrání**, nárok si ověřuje serverová
 * akce (`poznamky-actions.ts`).
 */
export function PoznamkyKlienta({
  klientId,
  poznamky,
  viewerId,
  jeAdmin,
}: {
  klientId: string;
  poznamky: PoznamkaKZobrazeni[];
  viewerId: string;
  jeAdmin: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [ceka, zahaj] = useTransition();

  function pridej() {
    zahaj(async () => {
      const vysledek = await pridejPoznamku(klientId, text);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="nova-poznamka">Nová poznámka</Label>
        <Textarea
          id="nova-poznamka"
          value={text}
          onChange={(udalost) => setText(udalost.target.value)}
          rows={3}
          maxLength={MAX_DELKA}
          placeholder="Cokoli, co se hodí vědět o klientovi."
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">Klient poznámky nevidí.</p>
          <Button onClick={pridej} disabled={ceka || text.trim() === ""}>
            {ceka && <Loader2 className="animate-spin" />}
            Přidat poznámku
          </Button>
        </div>
      </div>

      {poznamky.length === 0 ? (
        <p className="text-muted-foreground border-t pt-4 text-sm">Zatím tu žádná poznámka není.</p>
      ) : (
        <ul className="divide-border divide-y border-t" aria-label="Poznámky">
          {poznamky.map((poznamka) => (
            <Zapis
              key={poznamka.id}
              poznamka={poznamka}
              smiMenit={jeAdmin || poznamka.authorId === viewerId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Zapis({ poznamka, smiMenit }: { poznamka: PoznamkaKZobrazeni; smiMenit: boolean }) {
  const router = useRouter();
  const [upravuje, setUpravuje] = useState(false);
  const [text, setText] = useState(poznamka.text);
  const [ceka, zahaj] = useTransition();

  // Zápis bez autora udělal systém — lead z webu, objednávka, převod.
  const kdo = poznamka.authorName ?? "web a objednávky";

  function uloz() {
    zahaj(async () => {
      const vysledek = await upravPoznamku(poznamka.id, text);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      setUpravuje(false);
      router.refresh();
    });
  }

  return (
    <li className="space-y-1.5 py-3">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs">
          {kdo} · {formatDatumCas(poznamka.createdAt)}
          {/* Zapsala ji AI přes MCP jménem autora (Jakub, 5. 10. 2026). */}
          {poznamka.createdViaMcp && " · přes AI"}
        </p>
        {smiMenit && !upravuje && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUpravuje(true)}
              aria-label="Opravit poznámku"
              title="Opravit poznámku"
            >
              <Pencil />
            </Button>
            <SmazaniPoznamky poznamka={poznamka} kdo={kdo} />
          </>
        )}
      </div>

      {upravuje ? (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(udalost) => setText(udalost.target.value)}
            rows={3}
            maxLength={MAX_DELKA}
            aria-label="Text poznámky"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setText(poznamka.text);
                setUpravuje(false);
              }}
            >
              Zrušit
            </Button>
            <Button size="sm" onClick={uloz} disabled={ceka || text.trim() === ""}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">{poznamka.text}</p>
      )}
    </li>
  );
}

/**
 * Potvrzení smazání poznámky. **Každá mazací akce má potvrzovací okno**
 * (CLAUDE.md). Okno zůstane otevřené, když server smazání odmítne.
 */
function SmazaniPoznamky({ poznamka, kdo }: { poznamka: PoznamkaKZobrazeni; kdo: string }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  // Začátek textu, ať je v okně jasné, o kterou poznámku jde.
  const ukazka = poznamka.text.length > 80 ? `${poznamka.text.slice(0, 80)}…` : poznamka.text;

  return (
    <Dialog open={otevreno} onOpenChange={setOtevreno}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOtevreno(true)}
        aria-label="Smazat poznámku"
        title="Smazat poznámku"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat poznámku</DialogTitle>
          <DialogDescription>
            Opravdu smazat poznámku „{ukazka}&ldquo; ({kdo}, {formatDatumCas(poznamka.createdAt)})?{" "}
            <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Smazat smí jen autor poznámky a administrátor.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOtevreno(false)}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() =>
              zahaj(async () => {
                const vysledek = await smazPoznamku(poznamka.id);

                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                  toast.error(vysledek.chyba);
                  return;
                }

                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
              })
            }
          >
            {ceka && <Loader2 className="animate-spin" />}
            Smazat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
