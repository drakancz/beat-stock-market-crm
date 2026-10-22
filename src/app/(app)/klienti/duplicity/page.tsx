import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CopyCheck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { najdiDuplicity } from "@/lib/duplicity";
import { requireViewer } from "@/lib/session";

import { SeznamDuplicit } from "./seznam-duplicit";

export const metadata: Metadata = { title: "Možné duplicity" };

export const dynamic = "force-dynamic";

/**
 * Možné duplicity klientů (Jakub, 27. 9. 2026, krok 2B).
 *
 * **Vidí každý přihlášený** a každý smí potvrdit „nejsou stejný člověk“;
 * **sloučit smí jen administrátor** — tlačítko se jinému neukáže
 * a akce `sloucitKlienty()` ho odmítne `requireAdmin()`.
 */
export default async function DuplicityPage() {
  const viewer = await requireViewer();
  const duplicity = await najdiDuplicity();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Možné duplicity</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Dvojice klientů se stejným telefonem nebo stejným jménem. Rozhoduje člověk — systém nic
            neslučuje sám.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/klienti">
            <ArrowLeft />
            Zpět na klienty
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dvojice k rozhodnutí</CardTitle>
          <CardDescription>
            {viewer.role === "ADMINISTRATOR"
              ? "Sloučit přesune objednávky, poznámky, úkoly i přílohy na jednu kartu. Když jde o dva různé lidi, dej Nejsou stejný člověk a návrh zmizí."
              : "Když jde o dva různé lidi, dej Nejsou stejný člověk a návrh zmizí. Sloučit karty může administrátor."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {duplicity.length === 0 ? (
            <EmptyState
              icon={CopyCheck}
              title="Žádné možné duplicity."
              description="Žádní dva klienti nemají stejný telefon ani stejné jméno."
            />
          ) : (
            <SeznamDuplicit
              jeAdmin={viewer.role === "ADMINISTRATOR"}
              dvojice={duplicity.map((dvojice) => ({
                a: { ...dvojice.a, createdAt: dvojice.a.createdAt.toISOString() },
                b: { ...dvojice.b, createdAt: dvojice.b.createdAt.toISOString() },
                duvody: dvojice.duvody,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
