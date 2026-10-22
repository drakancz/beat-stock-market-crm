import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoBrokera } from "@/components/logo-brokera";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { db } from "@/lib/db";
import { idZAdresy } from "@/lib/parametry";
import { formatDatumCas } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { AUTO_CONNECT_LABEL } from "@/lib/types";

import { AkceBrokera } from "./akce-brokera";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/brokeri/[id]">): Promise<Metadata> {
  await requireViewer();
  const id = idZAdresy((await params).id);
  const broker = id ? await db.broker.findUnique({ where: { id }, select: { name: true } }) : null;
  return { title: broker?.name ?? "Broker" };
}

/**
 * Detail brokera — vidí ho každý přihlášený, mění administrátor.
 *
 * Úpravy a koš dostane jen administrátor, a i to je jen úklid rozhraní —
 * serverové akce si oprávnění ověřují samy. Seznam portfolií klientů tu
 * byl do 20. 10. 2026; zmizel s portfolii (Jakub).
 */
export default async function BrokerPage({ params }: PageProps<"/brokeri/[id]">) {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const broker = await db.broker.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      autoConnect: true,
      website: true,
      logo: true,
      note: true,
      deletedAt: true,
    },
  });
  if (!broker) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/brokeri">
          <ArrowLeft />
          Zpět na brokery
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <LogoBrokera nazev={broker.name} logo={broker.logo} className="size-12 text-sm" />
          <div>
            <h2 className="text-2xl font-semibold">{broker.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={broker.autoConnect === "ANO" ? "default" : "secondary"}>
                Napojení: {AUTO_CONNECT_LABEL[broker.autoConnect].toLowerCase()}
              </Badge>
              {broker.website && (
                <a
                  href={broker.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Web brokera
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>

        {jeAdmin && (
          <AkceBrokera
            vKosi={broker.deletedAt !== null}
            broker={{
              id: broker.id,
              name: broker.name,
              autoConnect: broker.autoConnect,
              website: broker.website,
              logo: broker.logo,
              note: broker.note,
            }}
          />
        )}
      </div>

      {broker.deletedAt && (
        <Alert>
          <AlertDescription className="leading-relaxed">
            Tenhle broker je <strong>smazaný</strong> od {formatDatumCas(broker.deletedAt)}. V
            seznamu brokerů se neukazuje.
          </AlertDescription>
        </Alert>
      )}

      {broker.note && (
        <Card>
          <CardHeader>
            <CardTitle>Poznámka</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm whitespace-pre-line">
            {broker.note}
          </CardContent>
        </Card>
      )}
    </>
  );
}
