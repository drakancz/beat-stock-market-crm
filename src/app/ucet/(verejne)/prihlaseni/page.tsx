import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getKlient } from "@/lib/klient/sezeni";

import { PrihlaseniKlientaForm } from "./prihlaseni-form";

export const metadata: Metadata = { title: "Přihlášení" };

export const dynamic = "force-dynamic";

/**
 * Přihlášení do klientské části. Kdo už přihlášený je, jde rovnou
 * dovnitř — rozhoduje server podle databáze, ne `proxy.ts` podle cookie
 * (stejný důvod jako u přihlášení týmu).
 */
export default async function PrihlaseniKlientaPage() {
  if (await getKlient()) redirect("/ucet");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Přihlášení</CardTitle>
        <CardDescription>
          Zadejte e-mail, na který vám přišla pozvánka, a své heslo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <PrihlaseniKlientaForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
