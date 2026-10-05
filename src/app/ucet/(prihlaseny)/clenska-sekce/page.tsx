import type { Metadata } from "next";
import Link from "next/link";
import { Crown } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { maPlatneClenstvi } from "@/lib/vzdelavani/pristup";

export const metadata: Metadata = { title: "Členská sekce" };

export const dynamic = "force-dynamic";

/**
 * Členská sekce (krok 3C). Články vidí jen klient s **právě platným**
 * členstvím; ostatním se vysvětlí, proč nic nevidí.
 */
export default async function ClenskaSekceKlientaPage() {
  const klient = await requireKlient();
  const clen = await maPlatneClenstvi(klient.clientId);

  const clanky = clen
    ? await db.memberPost.findMany({
        where: { deletedAt: null, publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { id: true, title: true, body: true, publishedAt: true },
      })
    : [];

  return (
    <>
      <h1 className="text-2xl font-semibold">Členská sekce</h1>

      {!clen ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-start gap-3 text-sm">
            <Crown className="size-5 shrink-0" aria-hidden />
            <p>
              Členská sekce je pro klienty s platným členstvím. Platnost svých produktů najdete na
              přehledu.
            </p>
          </CardContent>
        </Card>
      ) : clanky.length === 0 ? (
        <p className="text-muted-foreground text-sm">Obsah členské sekce připravujeme.</p>
      ) : (
        <ul className="space-y-3">
          {clanky.map((clanek) => (
            <li key={clanek.id}>
              <Card>
                <CardContent className="space-y-1">
                  <p className="text-muted-foreground text-xs">
                    {formatDatum(clanek.publishedAt!)}
                  </p>
                  <Link
                    href={`/ucet/clenska-sekce/${clanek.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {clanek.title}
                  </Link>
                  {clanek.body && (
                    <p className="text-muted-foreground line-clamp-2 text-sm">{clanek.body}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
