"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { odpovezNaDotaz } from "./dotazy-actions";

/**
 * Odpověď na dotaz klienta (Fáze 5C, 18. 10. 2026) — smí každý přihlášený.
 * Upozornění na pravidlo 9 je tu schválně: odpověď nesmí vypadat jako
 * investiční doporučení.
 */
export function OdpovedDotazu({
  dotazId,
  odpoved,
  maxZnaku,
}: {
  dotazId: string;
  odpoved: string | null;
  maxZnaku: number;
}) {
  const router = useRouter();
  const [upravuji, setUpravuji] = useState(odpoved === null);
  const [ceka, zahaj] = useTransition();

  if (!upravuji) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setUpravuji(true)}>
        Opravit odpověď
      </Button>
    );
  }

  return (
    <form
      method="post"
      className="space-y-2"
      onSubmit={(udalost) => {
        udalost.preventDefault();
        // Hodnota až z formuláře; prázdnou odpověď odmítne server.
        const text = String(new FormData(udalost.currentTarget).get("text") ?? "");
        zahaj(async () => {
          const vysledek = await odpovezNaDotaz(dotazId, text);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          setUpravuji(false);
          router.refresh();
        });
      }}
    >
      <Label htmlFor={`odpoved-${dotazId}`}>Odpověď klientovi</Label>
      <Textarea
        id={`odpoved-${dotazId}`}
        name="text"
        defaultValue={odpoved ?? ""}
        rows={4}
        maxLength={maxZnaku}
      />
      <Alert>
        <TriangleAlert />
        <AlertDescription className="text-xs leading-relaxed">
          Žádné investiční rady (kupte, prodejte, konkrétní cíle) — na to je potřeba licence.
          Vysvětlit látku z lekce ano. Klient odpověď uvidí u lekce a dostane upozornění.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={ceka}>
          {ceka && <Loader2 className="animate-spin" />}
          {odpoved === null ? "Odeslat odpověď" : "Uložit opravu"}
        </Button>
        {odpoved !== null && (
          <Button type="button" variant="outline" onClick={() => setUpravuji(false)}>
            Zrušit
          </Button>
        )}
      </div>
    </form>
  );
}
