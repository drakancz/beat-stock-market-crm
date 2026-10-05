import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireKlient } from "@/lib/klient/sezeni";
import { idZAdresy } from "@/lib/parametry";
import { nactiKurzKlienta } from "@/lib/vzdelavani/klient";

import { Postup } from "../postup";

export const metadata: Metadata = { title: "Kurz" };

export const dynamic = "force-dynamic";

/** Kurz klienta se seznamem lekcí. Nevlastněný kurz = 404. */
export default async function KurzKlientaPage({ params }: PageProps<"/ucet/kurzy/[id]">) {
  const klient = await requireKlient();
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const kurz = await nactiKurzKlienta(klient.clientId, id);
  if (!kurz) notFound();

  const hotovo = kurz.lekce.filter((lekce) => lekce.hotovo).length;
  const dalsi = kurz.lekce.find((lekce) => !lekce.hotovo) ?? kurz.lekce[0];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/ucet/kurzy">
          <ArrowLeft />
          Všechny kurzy
        </Link>
      </Button>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{kurz.title}</h1>
        {kurz.description && <p className="text-muted-foreground text-sm">{kurz.description}</p>}
        <Postup hotovo={hotovo} celkem={kurz.lekce.length} />
      </div>

      {dalsi && (
        <Button asChild className="self-start">
          <Link href={`/ucet/lekce/${dalsi.id}`}>
            {hotovo === 0
              ? "Začít první lekcí"
              : hotovo === kurz.lekce.length
                ? "Projít znovu"
                : "Pokračovat"}
          </Link>
        </Button>
      )}

      <Card>
        <CardContent>
          {kurz.lekce.length === 0 ? (
            <p className="text-muted-foreground text-sm">Lekce kurzu připravujeme.</p>
          ) : (
            <ol className="divide-border divide-y">
              {kurz.lekce.map((lekce, poradi) => (
                <li key={lekce.id}>
                  <Link
                    href={`/ucet/lekce/${lekce.id}`}
                    className="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm"
                  >
                    {lekce.hotovo ? (
                      <CheckCircle2 className="text-primary size-5 shrink-0" aria-label="hotovo" />
                    ) : (
                      <Circle
                        className="text-muted-foreground size-5 shrink-0"
                        aria-label="zatím ne"
                      />
                    )}
                    <span className="text-muted-foreground w-6 shrink-0 text-right font-mono">
                      {poradi + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{lekce.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
