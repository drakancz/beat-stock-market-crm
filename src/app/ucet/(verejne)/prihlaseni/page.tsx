import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PrepinacJazyka } from "@/components/prepinac-jazyka";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { nactiJazyk } from "@/lib/jazyk-server";
import { getKlient } from "@/lib/klient/sezeni";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";
import { jeUkazka, UKAZKOVY_KLIENT } from "@/lib/ukazka";

import { PrihlaseniKlientaForm } from "./prihlaseni-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: TEXTY_VSTUPU[await nactiJazyk()].prihlaseni };
}

export const dynamic = "force-dynamic";

/**
 * Přihlášení do klientské části. Kdo už přihlášený je, jde rovnou
 * dovnitř — rozhoduje server podle databáze, ne `proxy.ts` podle cookie
 * (stejný důvod jako u přihlášení týmu).
 */
export default async function PrihlaseniKlientaPage() {
  if (await getKlient()) redirect("/ucet");
  const jazyk = await nactiJazyk();
  const t = TEXTY_VSTUPU[jazyk];

  return (
    <Card lang={jazyk}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>
            {/* Hlavní nadpis stránky pro čtečky obrazovky (axe, 23. 10. 2026). */}
            <h1>{t.prihlaseni}</h1>
          </CardTitle>
          <PrepinacJazyka jazyk={jazyk} />
        </div>
        <CardDescription>{t.klient.popis}</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <PrihlaseniKlientaForm jazyk={jazyk} ukazka={jeUkazka() ? UKAZKOVY_KLIENT : undefined} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
