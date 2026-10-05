import type { Metadata } from "next";
import { Bell, Users } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";

import { FormularUpozorneni } from "./formular";

export const metadata: Metadata = { title: "Upozornění" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Upozornění (Jakub, 15. 9. 2026).
 *
 * **Vidí i mění jen administrátor.** Vypínač e-mailů o nových chybách
 * a seznam, komu chodí. Samotné odesílání je v `src/lib/upozorneni-chyb.ts`.
 */
export default async function UpozorneniPage() {
  await requireAdmin();

  const [nastaveni, administratori] = await Promise.all([
    nactiNastaveni(),
    db.user.findMany({
      where: { role: "ADMINISTRATOR", active: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Upozornění na chyby e-mailem
            {nastaveni.errorNotificationsEnabled ? (
              <Badge variant="secondary">Zapnuto</Badge>
            ) : (
              <Badge variant="outline">Vypnuto</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Když v SmartEmailing → Chyby přibude nová chyba, přijde administrátorům e-mail. Nejvýš
            jednou za 15 minut — chyby, které mezitím přibudou, se sečtou do dalšího e-mailu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormularUpozorneni zapnuto={nastaveni.errorNotificationsEnabled} />
          <p className="text-muted-foreground text-xs">
            Naposledy odešlo:{" "}
            {nastaveni.errorNotificationSentAt
              ? formatDatumCas(nastaveni.errorNotificationSentAt)
              : "zatím nikdy"}
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Komu upozornění chodí
          </CardTitle>
          <CardDescription>
            Všem aktivním administrátorům. Kdo administrátorem nově bude, začne je dostávat sám.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {administratori.map((clovek) => (
              <li
                key={clovek.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="text-sm font-medium">{clovek.name}</span>
                <span className="text-muted-foreground text-xs">{clovek.email}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <PoznamkaPodCarou>
        V e-mailu nejsou osobní údaje — jen druh chyby, počet a důvod; koho se týká, je vidět v
        SmartEmailing → Chyby. Chyby samotného odesílání e-mailů upozornění neposílají, protože když
        nefunguje pošta, nedorazilo by. Upozornění naplánované na konec patnáctiminutové lhůty se
        při restartu aplikace ztratí; chyby pak přijdou s dalším upozorněním.
      </PoznamkaPodCarou>
    </>
  );
}
