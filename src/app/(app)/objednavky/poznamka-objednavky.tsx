"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, StickyNote } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

import { ulozPoznamkuObjednavky } from "./actions";

/**
 * Poznámka týmu k objednávce.
 *
 * Je to jediné pole objednávky, které jde v CRM změnit — co si klient
 * objednal, se nepřepisuje. Mění ji každý, kdo objednávku vidí.
 *
 * **Klient ji nikdy nevidí** a do auditního logu se z ní nepíše obsah,
 * jen že se změnila (security_warnings.md, pravidlo 8).
 */
export function PoznamkaObjednavky({
  objednavka,
  velikost,
}: {
  objednavka: { id: string; number: string; note: string | null };
  velikost?: "sm" | "icon";
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [text, setText] = useState(objednavka.note ?? "");
  const [ceka, zahaj] = useTransition();

  return (
    <>
      <Button
        variant="outline"
        size={velikost}
        aria-label={`Poznámka k objednávce ${objednavka.number}`}
        onClick={() => {
          // Při každém otevření se vychází z toho, co je uložené —
          // rozepsaný text z minula by se jinak vrátil i po zrušení.
          setText(objednavka.note ?? "");
          setOtevreno(true);
        }}
      >
        <StickyNote />
        {velikost === "icon" ? null : "Poznámka"}
      </Button>

      <Dialog open={otevreno} onOpenChange={setOtevreno}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Poznámka k objednávce</DialogTitle>
            <DialogDescription>
              Interní zápisník týmu k objednávce <strong>{objednavka.number}</strong>. Klient ho
              nevidí.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={text}
            onChange={(udalost) => setText(udalost.target.value)}
            placeholder="Třeba domluvený odklad platby nebo co klient řešil po telefonu."
            maxLength={2000}
            rows={6}
            aria-label="Text poznámky"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button
              disabled={ceka}
              onClick={() =>
                zahaj(async () => {
                  const vysledek = await ulozPoznamkuObjednavky(objednavka.id, text);

                  if (!vysledek.ok) {
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
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
