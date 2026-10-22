import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ListChecks, UserRoundX } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { nactiNastaveni } from "@/lib/nastaveni";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import { requireAdmin } from "@/lib/session";

import { FormularNechodi } from "./formular-nechodi";
import { FormularPripominekPlatby } from "./formular-platby";

export const metadata: Metadata = { title: "Prodloužení" };

export const dynamic = "force-dynamic";

/** Kolik dní dopředu ukazuje přehled „Končí v nejbližších …“. */
const DNI_PREDEM = 14;

/**
 * Nastavení → Prodloužení (Jakub, 24. 9. 2026).
 *
 * **Vidí i mění jen administrátor** (zábrana i v rámu `nastaveni/layout.tsx`).
 * Připomínky nezaplacené objednávky, hranice „Platí, ale nechodí“ a přehled,
 * komu brzy končí členství. Úkol „zavolat kvůli prodloužení“ zanikl
 * 20. 10. 2026 (Jakub).
 */
export default async function ProdlouzeniPage() {
  await requireAdmin();

  const nastaveni = await nactiNastaveni();
  const dnes = dnesniZacatek();

  // Přehled, komu brzy končí členství.
  const konci = await db.productValidity.findMany({
    where: {
      validUntil: { gte: dnes, lte: posunDne(dnes, DNI_PREDEM) },
      client: { deletedAt: null },
    },
    orderBy: { validUntil: "asc" },
    select: {
      id: true,
      validUntil: true,
      client: { select: { id: true, name: true } },
      product: { select: { name: true } },
    },
  });

  return (
    <>
      {/* Připomínka nezaplacené objednávky (Fáze 5A, Jakub 11. 10. 2026). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Připomínka nezaplacené objednávky
          </CardTitle>
          <CardDescription>
            Klient, jehož objednávka je pořád Nová nebo Nezaplaceno, dostane ráno připomínku —
            oznámením na telefon, jinak e-mailem. Jde jen klientům s účtem v klientské části. Kdy
            připomínka odešla, je vidět u objednávky.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularPripominekPlatby
            zapnuto={nastaveni.paymentRemindersEnabled}
            prvniDnu={nastaveni.paymentReminderFirstDays}
            druhaDnu={nastaveni.paymentReminderSecondDays}
          />
        </CardContent>
      </Card>

      {/* Platí, ale nechodí (Fáze 5B, Jakub 15. 10. 2026). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundX className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Platí, ale nechodí
          </CardTitle>
          <CardDescription>
            Člen, kterému běží členství a který tolik dní nebyl v klientské části ani nezaplatil,
            dostane v seznamu klientů značku Nechodí a jde vyfiltrovat. Značku vidí každý
            přihlášený. Kupci kurzu bez členství ji nedostávají.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularNechodi dni={nastaveni.inactiveMemberDays} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Končí v nejbližších {pocet(DNI_PREDEM, "dni", "dnech", "dnech")}
          </CardTitle>
          <CardDescription>
            {konci.length === 0
              ? "Nikomu nic nekončí."
              : `Končících platností: ${konci.length}. Klient dostane upozornění týden předem a v den konce.`}
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
        Délku platnosti produktů nastavíš v Produktech, konec u jednoho klienta na jeho kartě.
      </PoznamkaPodCarou>
    </>
  );
}
