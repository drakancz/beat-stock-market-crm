import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/lib/session";
import { overDatabazi } from "@/lib/zdravi";

import { PrihlaseniForm } from "./prihlaseni-form";

export const metadata: Metadata = { title: "Přihlášení" };

export const dynamic = "force-dynamic";

/**
 * Přihlašovací obrazovka.
 *
 * Kdo už přihlášený je, se sem nedostane — ale rozhoduje se to **tady na
 * serveru**, ne v `proxy.ts` podle přítomnosti cookie. Cookie totiž může
 * zůstat v prohlížeči i člověku, který mezitím skončil v koši nebo mu byl
 * odebrán přístup; odbočení podle ní by ho zacyklilo mezi přihlášením
 * a aplikací. `getViewer()` sáhne do databáze, takže ví, jak to je.
 *
 * **Tahle stránka je zároveň kontrolou zdraví** — pro Railway
 * (Healthcheck Path v nastavení služby na Railway) i pro sledování dostupnosti zvenku.
 * Proto se hned na začátku ověří, že databáze odpovídá: `getViewer()` se
 * jí totiž ptá jen u toho, kdo už přihlášení v prohlížeči má, a bez něj by
 * stránka hlásila „v pořádku" i s nedostupnou databází (Jakub, 20. 9. 2026).
 */
export default async function PrihlaseniPage() {
  await overDatabazi();

  if (await getViewer()) redirect("/dashboard");

  return <Obsah />;
}

function Obsah() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Přihlášení</CardTitle>
        <CardDescription>Zadej e-mail a heslo, kterými se do CRM dostáváš.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <PrihlaseniForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
