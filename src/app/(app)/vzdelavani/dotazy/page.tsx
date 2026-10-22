import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { precti, vyberParam } from "@/lib/parametry";
import { requireViewer } from "@/lib/session";
import { MAX_ODPOVED, nactiDotazyProTym } from "@/lib/vzdelavani/dotazy";
import { z } from "zod";

import { OdpovedDotazu } from "../odpoved-dotazu";
import { smazDotaz } from "../dotazy-actions";
import { SmazaniObsahu } from "../smazani-obsahu";

export const metadata: Metadata = { title: "Dotazy k lekcím" };

export const dynamic = "force-dynamic";

/**
 * Vzdělávání → Dotazy (Fáze 5C, Jakub 18. 10. 2026). **Vidí a odpovídá
 * každý přihlášený, smazat smí jen administrátor.** Dotazy jsou soukromé —
 * klient vidí jen svoje u lekce.
 */
export default async function DotazyPage({ searchParams }: PageProps<"/vzdelavani/dotazy">) {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const { zobrazit } = precti(
    z.object({ zobrazit: vyberParam(["vse"] as const) }),
    await searchParams,
  );
  const vse = zobrazit === "vse";
  const dotazy = await nactiDotazyProTym(!vse);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Dotazy klientů k lekcím</CardTitle>
          <CardDescription>
            Dotaz vidí jen klient, který ho položil, a tým. Odpovědět může kdokoli z týmu.
          </CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={vse ? "/vzdelavani/dotazy" : "/vzdelavani/dotazy?zobrazit=vse"}>
            {vse ? "Jen čekající" : "Zobrazit i zodpovězené"}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {dotazy.length === 0 ? (
          <EmptyState
            icon={MessageCircleQuestion}
            title={vse ? "Zatím žádný dotaz." : "Žádný dotaz nečeká na odpověď."}
          />
        ) : (
          <ol className="space-y-4" aria-label="Dotazy">
            {dotazy.map((dotaz) => (
              <li key={dotaz.id} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p>
                      <Link
                        href={`/klienti/${dotaz.klient.id}`}
                        className="font-medium hover:underline"
                      >
                        {dotaz.klient.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">· {dotaz.kdy}</span>
                    </p>
                    <p className="text-muted-foreground break-words">
                      <Link href={`/vzdelavani/kurzy/${dotaz.kurz.id}`} className="hover:underline">
                        {dotaz.kurz.title}
                      </Link>{" "}
                      → {dotaz.lekce}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={dotaz.odpoved ? "secondary" : "default"}>
                      {dotaz.odpoved ? "Zodpovězeno" : "Čeká"}
                    </Badge>
                    {jeAdmin && (
                      <SmazaniObsahu
                        maly
                        titulek="Smazat dotaz"
                        nazev={`dotaz od ${dotaz.klient.name}`}
                        dusledky="Klient ho u lekce přestane vidět i s odpovědí."
                        smazat={smazDotaz.bind(null, dotaz.id)}
                      />
                    )}
                  </div>
                </div>
                <p className="text-sm break-words whitespace-pre-line">{dotaz.text}</p>
                {dotaz.odpoved && (
                  <div className="bg-muted/60 space-y-1 rounded-md p-3 text-sm">
                    <p className="text-muted-foreground text-xs">
                      Odpověď · {dotaz.odpovezeno}
                      {dotaz.kdoOdpovedel && ` · ${dotaz.kdoOdpovedel}`}
                    </p>
                    <p className="break-words whitespace-pre-line">{dotaz.odpoved}</p>
                  </div>
                )}
                <OdpovedDotazu dotazId={dotaz.id} odpoved={dotaz.odpoved} maxZnaku={MAX_ODPOVED} />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
