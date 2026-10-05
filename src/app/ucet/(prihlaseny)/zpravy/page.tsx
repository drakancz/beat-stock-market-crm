import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";

export const metadata: Metadata = { title: "Zprávy" };

export const dynamic = "force-dynamic";

/**
 * Zprávy od nás v klientské části (krok 3A, Jakub 4. 10. 2026).
 *
 * **Vidí jen přihlášený klient, jen svoje** — filtruje se podle
 * `klient.clientId` z přihlášení. Otevřením se nepřečtené označí jako
 * přečtené; administrátor to vidí na kartě klienta.
 */
export default async function ZpravyKlientaPage() {
  const klient = await requireKlient();

  const zpravy = await db.clientMessage.findMany({
    where: { clientId: klient.clientId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, text: true, createdAt: true, readAt: true },
  });

  const neprectene = zpravy.filter((zprava) => !zprava.readAt).map((zprava) => zprava.id);
  if (neprectene.length > 0) {
    await db.clientMessage.updateMany({
      where: { id: { in: neprectene }, clientId: klient.clientId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/ucet">
          <ArrowLeft />
          Zpět na přehled
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold">Zprávy</h1>

      {zpravy.length === 0 ? (
        <p className="text-muted-foreground text-sm">Zatím jsme vám žádnou zprávu neposlali.</p>
      ) : (
        <ul className="space-y-3">
          {zpravy.map((zprava) => (
            <li key={zprava.id}>
              <Card>
                <CardContent className="space-y-2">
                  <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    {formatDatumCas(zprava.createdAt)}
                    {!zprava.readAt && (
                      <span className="bg-primary text-primary-foreground rounded px-1.5 py-0.5 font-medium">
                        nová
                      </span>
                    )}
                  </p>
                  <p className="text-sm whitespace-pre-line">{zprava.text}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
