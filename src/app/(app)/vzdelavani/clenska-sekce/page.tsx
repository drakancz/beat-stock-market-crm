import type { Metadata } from "next";
import { Crown, Video } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { requireViewer } from "@/lib/session";

import { smazClanek, ulozClanek } from "../clanky-actions";
import { ObsahDialog } from "../obsah-dialog";
import { SmazaniObsahu } from "../smazani-obsahu";

export const metadata: Metadata = { title: "Vzdělávání — členská sekce" };

export const dynamic = "force-dynamic";

/**
 * Členská sekce (krok 3C). **Vidí každý přihlášený, mění jen
 * administrátor.** Klient článek uvidí, jen když má platné členství.
 */
export default async function ClenskaSekcePage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  const clanky = await db.memberPost.findMany({
    where: { deletedAt: null },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: { id: true, title: true, body: true, videoUrl: true, publishedAt: true },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Členská sekce</CardTitle>
          <CardDescription>
            Články a videa pro klienty s platným členstvím (kterýmkoli). Po konci členství je klient
            přestane vidět.
          </CardDescription>
        </div>
        {jeAdmin && <ObsahDialog druh="článek" skryte={{}} ulozit={ulozClanek} sezverejnenim />}
      </CardHeader>
      <CardContent>
        {clanky.length === 0 ? (
          <EmptyState
            icon={Crown}
            title="Členská sekce je zatím prázdná."
            description={jeAdmin ? "Přidej první článek tlačítkem Nový článek." : undefined}
          />
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {clanky.map((clanek) => (
              <li key={clanek.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{clanek.title}</p>
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {clanek.videoUrl && (
                      <Video className="mr-1 inline size-3.5 align-[-2px]" aria-label="s videem" />
                    )}
                    {clanek.publishedAt ? formatDatum(clanek.publishedAt) : "koncept"} ·{" "}
                    {clanek.body.slice(0, 120) || "jen video"}
                  </p>
                </div>
                <Badge variant={clanek.publishedAt ? "default" : "secondary"}>
                  {clanek.publishedAt ? "Zveřejněno" : "Koncept"}
                </Badge>
                {jeAdmin && (
                  <div className="flex shrink-0 items-center">
                    <ObsahDialog
                      druh="článek"
                      skryte={{ id: clanek.id }}
                      obsah={{
                        title: clanek.title,
                        body: clanek.body,
                        videoUrl: clanek.videoUrl ?? "",
                        zverejneno: clanek.publishedAt !== null,
                      }}
                      ulozit={ulozClanek}
                      sezverejnenim
                    />
                    <SmazaniObsahu
                      maly
                      titulek="Smazat článek"
                      nazev={clanek.title}
                      dusledky="Zmizí z členské sekce u všech klientů."
                      smazat={smazClanek.bind(null, clanek.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
