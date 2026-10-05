import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleAlert, ListChecks } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { nactiNastaveni } from "@/lib/nastaveni";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import { requireAdmin } from "@/lib/session";

import { FormularProdlouzeni } from "./formular";

export const metadata: Metadata = { title: "Prodloužení" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Prodloužení (Jakub, 24. 9. 2026).
 *
 * **Vidí i mění jen administrátor** (zábrana i v rámu `nastaveni/layout.tsx`).
 * Kdo dostává úkol „zavolat kvůli prodloužení" a kolik dní před koncem
 * platnosti. Samotné zakládání úkolů je v `src/lib/platnost.ts`.
 */
export default async function ProdlouzeniPage() {
  await requireAdmin();

  const nastaveni = await nactiNastaveni();
  const dnes = dnesniZacatek();

  const [lide, konci] = await Promise.all([
    db.user.findMany({
      where: { active: true, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    // Přehled, co končí v nastavené lhůtě — ať je vidět, kolik úkolů vznikne.
    db.productValidity.findMany({
      where: {
        validUntil: { gte: dnes, lte: posunDne(dnes, nastaveni.renewalLeadDays) },
        client: { deletedAt: null },
      },
      orderBy: { validUntil: "asc" },
      select: {
        id: true,
        validUntil: true,
        client: { select: { id: true, name: true } },
        product: { select: { name: true } },
      },
    }),
  ]);

  const resitel = lide.find((clovek) => clovek.id === nastaveni.renewalUserId) ?? null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Úkoly na prodloužení členství
          </CardTitle>
          <CardDescription>
            Když klientovi za méně dní, než je tady nastavené, skončí platnost produktu, dostane
            vybraný člověk v Mém dni na Dashboardu úkol „zavolat kvůli prodloužení“ s termínem v den
            konce. Když klient mezitím prodlouží, úkol se sám odškrtne.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!resitel && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Nikdo vybraný není — úkoly nevznikají</AlertTitle>
              <AlertDescription>
                {nastaveni.renewalUserId
                  ? "Vybraný člověk už v týmu není nebo nemá přístup. Vyber někoho jiného."
                  : "Vyber člověka, který prodloužení řeší."}
              </AlertDescription>
            </Alert>
          )}
          <FormularProdlouzeni
            lide={lide}
            resitelId={resitel?.id ?? null}
            dniPredem={nastaveni.renewalLeadDays}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Končí v nejbližších {pocet(nastaveni.renewalLeadDays, "dni", "dnech", "dnech")}
          </CardTitle>
          <CardDescription>
            {konci.length === 0
              ? "Nikomu nic nekončí."
              : `Platností, ke kterým vznikne úkol: ${konci.length}.`}
          </CardDescription>
        </CardHeader>
        {konci.length > 0 && (
          <CardContent>
            <ul className="divide-border divide-y">
              {konci.map((radek) => (
                <li
                  key={radek.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <Link
                    href={`/klienti/${radek.client.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {radek.client.name}
                  </Link>
                  <span className="text-muted-foreground min-w-0 flex-1 text-xs">
                    {radek.product.name}
                  </span>
                  <span className="tabular text-sm whitespace-nowrap">
                    do {formatDatum(radek.validUntil!)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <PoznamkaPodCarou>
        Úkoly se zakládají ve chvíli, kdy někdo otevře Dashboard — jsou vidět jen tam, takže se tím
        neopozdí. Ke každému konci vznikne jen jeden úkol; kdo ho smaže, další nedostane, dokud se
        konec nezmění. Délku platnosti produktů nastavíš v Produktech, konec u jednoho klienta na
        jeho kartě.
      </PoznamkaPodCarou>
    </>
  );
}
