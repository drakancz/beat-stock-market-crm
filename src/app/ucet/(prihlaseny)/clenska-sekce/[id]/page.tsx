import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ObsahVzdelavani } from "@/components/vzdelavani/obsah";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { idZAdresy } from "@/lib/parametry";
import { maPlatneClenstvi } from "@/lib/vzdelavani/pristup";

export const metadata: Metadata = { title: "Členská sekce" };

export const dynamic = "force-dynamic";

/** Článek členské sekce. Bez platného členství = 404. */
export default async function ClanekKlientaPage({ params }: PageProps<"/ucet/clenska-sekce/[id]">) {
  const klient = await requireKlient();
  const id = idZAdresy((await params).id);
  if (!id || !(await maPlatneClenstvi(klient.clientId))) notFound();

  const clanek = await db.memberPost.findFirst({
    where: { id, deletedAt: null, publishedAt: { not: null } },
    select: { title: true, body: true, videoUrl: true, publishedAt: true },
  });
  if (!clanek) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/ucet/clenska-sekce">
          <ArrowLeft />
          Členská sekce
        </Link>
      </Button>
      <div>
        <p className="text-muted-foreground text-sm">{formatDatum(clanek.publishedAt!)}</p>
        <h1 className="text-2xl font-semibold">{clanek.title}</h1>
      </div>
      <Card>
        <CardContent>
          <ObsahVzdelavani text={clanek.body} videoUrl={clanek.videoUrl} nazev={clanek.title} />
        </CardContent>
      </Card>
    </>
  );
}
