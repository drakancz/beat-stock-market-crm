import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { adresaServisnihoUctu } from "@/lib/kalendar";
import { requireAdmin } from "@/lib/session";

import { FormularKalendare } from "./formular";

export const metadata: Metadata = { title: "Kalendář" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Kalendář (Jakub, 20. 10. 2026): rezervace konzultací do
 * jednoho firemního Google Kalendáře. **Vidí i mění jen administrátor**
 * (zábrana i v rámu `nastaveni/layout.tsx`). Adresa servisního účtu se
 * ukazuje, aby šlo kalendář nasdílet — tajná není, klíč se nezobrazuje.
 */
export default async function KalendarPage() {
  await requireAdmin();

  const nastaveni = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { googleCalendarId: true, googleCalendarActive: true },
  });
  const servisniUcet = adresaServisnihoUctu();
  const zapnuto = !!servisniUcet && !!nastaveni?.googleCalendarActive;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
          Google Kalendář
          <Badge variant={zapnuto ? "default" : "outline"}>{zapnuto ? "Zapnuto" : "Vypnuto"}</Badge>
        </CardTitle>
        <CardDescription>
          Rezervace konzultace se zapíše jako událost do firemního kalendáře, zrušení ji smaže a
          přeložení přesune. V události je jméno klienta, čas, místo, odkaz na připojení a kdo
          konzultaci vede — <strong>nikdy e-mail ani telefon</strong>. Klient pozvánku nedostane.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {servisniUcet ? (
          <Alert>
            <AlertTitle>Komu kalendář nasdílet</AlertTitle>
            <AlertDescription>
              <p>
                V Google Kalendáři → Nastavení kalendáře → Sdílet s konkrétními lidmi přidej adresu
                níž s oprávněním <strong>Provádět změny událostí</strong>:
              </p>
              <p className="font-mono text-xs break-all" data-testid="servisni-ucet">
                {servisniUcet}
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>Na serveru chybí klíč servisního účtu</AlertTitle>
            <AlertDescription>
              Dokud na serveru nejsou proměnné GOOGLE_KALENDAR_UCET a GOOGLE_KALENDAR_KLIC, napojení
              zapnout nejde.
            </AlertDescription>
          </Alert>
        )}

        <FormularKalendare
          kalendar={nastaveni?.googleCalendarId ?? null}
          zapnuto={zapnuto}
          maKlic={!!servisniUcet}
        />
      </CardContent>
    </Card>
  );
}
