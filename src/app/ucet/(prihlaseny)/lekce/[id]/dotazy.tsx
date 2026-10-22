"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DotazKlienta } from "@/lib/vzdelavani/dotazy";

import { SmazaniObsahu } from "@/app/(app)/vzdelavani/smazani-obsahu";

import { polozDotaz, stahniDotaz } from "../../kurzy/actions";

/**
 * Dotazy u lekce (Fáze 5C, 18. 10. 2026) — klient vidí jen svoje dotazy
 * a odpovědi týmu, ostatní klienti je nevidí. Nezodpovězený dotaz jde
 * stáhnout (s potvrzením).
 */
export function DotazyLekce({
  lekceId,
  dotazy,
  maxZnaku,
}: {
  lekceId: string;
  dotazy: DotazKlienta[];
  maxZnaku: number;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleQuestion className="text-muted-foreground size-4" aria-hidden />
          Dotaz k lekci
        </CardTitle>
        <CardDescription>
          Dotaz uvidí jen náš tým, ne ostatní klienti. Odpovíme co nejdřív a dáme vám vědět.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {dotazy.length > 0 && (
          <ol className="space-y-3" aria-label="Moje dotazy">
            {dotazy.map((dotaz) => (
              <li key={dotaz.id} className="space-y-2 rounded-md border p-3 text-sm">
                <p className="text-muted-foreground text-xs">Váš dotaz · {dotaz.kdy}</p>
                <p className="break-words whitespace-pre-line">{dotaz.text}</p>
                {dotaz.odpoved ? (
                  <div className="bg-muted/60 space-y-1 rounded-md p-2">
                    <p className="text-muted-foreground text-xs">Odpověď · {dotaz.odpovezeno}</p>
                    <p className="break-words whitespace-pre-line">{dotaz.odpoved}</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs">Čeká na odpověď.</p>
                    <SmazaniObsahu
                      titulek="Stáhnout dotaz"
                      nazev={`dotaz ze dne ${dotaz.kdy}`}
                      dusledky="Tým ho už neuvidí."
                      smazat={stahniDotaz.bind(null, dotaz.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        <form
          method="post"
          className="space-y-2"
          onSubmit={(udalost) => {
            udalost.preventDefault();
            // Hodnota až z formuláře — pole vyplněné dřív, než stránka ožije
            // (pomalý telefon), se tak neztratí. Prázdný dotaz odmítne server.
            const formular = udalost.currentTarget;
            const text = String(new FormData(formular).get("text") ?? "");
            zahaj(async () => {
              const vysledek = await polozDotaz(lekceId, text);
              if (!vysledek.ok) {
                toast.error(vysledek.chyba);
                return;
              }
              formular.reset();
              toast.success("Dotaz jsme přijali.");
              router.refresh();
            });
          }}
        >
          <Label htmlFor={`dotaz-${lekceId}`}>Máte k lekci dotaz?</Label>
          <Textarea id={`dotaz-${lekceId}`} name="text" rows={3} maxLength={maxZnaku} />
          <Button type="submit" disabled={ceka}>
            {ceka && <Loader2 className="animate-spin" />}
            Odeslat dotaz
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
