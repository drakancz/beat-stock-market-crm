import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListOrdered, Lock, Star, Video } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { idZAdresy } from "@/lib/parametry";
import { requireViewer } from "@/lib/session";
import { kurzyBezObsahu } from "@/lib/vzdelavani/crm";
import { jakoDen } from "@/lib/obdobi";
import { formatPrumer, nactiHodnoceniLekci, NEJVIC_HVEZD } from "@/lib/vzdelavani/hodnoceni";
import { popisPravidla, VYBER_PRAVIDLA } from "@/lib/vzdelavani/odemykani";
import { prectiOtazky } from "@/lib/vzdelavani/kvizy";

import { KurzDialog } from "../../kurz-dialog";
import { smazKurz, smazKviz, smazLekci, ulozLekci } from "../../kurzy-actions";
import { KvizDialog } from "../../kviz-dialog";
import { ObsahDialog } from "../../obsah-dialog";
import { PosunLekce } from "../../posun-lekce";
import { SmazaniObsahu } from "../../smazani-obsahu";

export const dynamic = "force-dynamic";

async function nactiKurz(id: string) {
  return db.course.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      productId: true,
      title: true,
      description: true,
      publishedAt: true,
      product: { select: { name: true } },
      lekce: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          body: true,
          videoUrl: true,
          ...VYBER_PRAVIDLA,
          kviz: { select: { questions: true, deletedAt: true } },
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/vzdelavani/kurzy/[id]">): Promise<Metadata> {
  await requireViewer();
  const id = idZAdresy((await params).id);
  const kurz = id ? await nactiKurz(id) : null;
  return { title: kurz?.title ?? "Kurz" };
}

/**
 * Detail kurzu s lekcemi (krok 3C). **Vidí každý přihlášený, mění jen
 * administrátor** — tlačítka se ukazují jen jemu, ochrana je v akcích.
 */
export default async function KurzPage({ params }: PageProps<"/vzdelavani/kurzy/[id]">) {
  const viewer = await requireViewer();
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const kurz = await nactiKurz(id);
  if (!kurz) notFound();

  const jeAdmin = viewer.role === "ADMINISTRATOR";
  const [produkty, kupcu, hodnoceni] = await Promise.all([
    jeAdmin ? kurzyBezObsahu(kurz.id) : Promise.resolve([]),
    // Kolik klientů má kurz zaplacený — tolik ho vidí v klientské části.
    db.client.count({
      where: {
        deletedAt: null,
        orders: {
          some: {
            status: "ZAPLACENO",
            deletedAt: null,
            items: { some: { productId: kurz.productId } },
          },
        },
      },
    }),
    // Hodnocení lekcí (5C, 18. 10. 2026) — vidí každý přihlášený.
    nactiHodnoceniLekci(kurz.lekce.map((lekce) => lekce.id)),
  ]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/vzdelavani">
          <ArrowLeft />
          Zpět na kurzy
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {kurz.title}
            <Badge variant={kurz.publishedAt ? "default" : "secondary"}>
              {kurz.publishedAt ? "Zveřejněno" : "Koncept"}
            </Badge>
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {kurz.product.name} · zaplacený má {pocet(kupcu, "klient", "klienti", "klientů")}
          </p>
          {kurz.description && <p className="mt-2 max-w-2xl text-sm">{kurz.description}</p>}
        </div>
        {jeAdmin && (
          <div className="flex flex-wrap gap-2">
            <KurzDialog
              produkty={produkty}
              kurz={{
                id: kurz.id,
                productId: kurz.productId,
                title: kurz.title,
                description: kurz.description ?? "",
                zverejneno: kurz.publishedAt !== null,
              }}
            />
            <SmazaniObsahu
              titulek="Smazat kurz"
              nazev={kurz.title}
              dusledky="Kurz i jeho lekce zmizí z klientské části, i u klientů, kteří ho mají zaplacený. Objednávky se nemění."
              smazat={smazKurz.bind(null, kurz.id)}
              poSmazani="/vzdelavani"
            />
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Lekce</CardTitle>
            <CardDescription>
              V tomhle pořadí je klient uvidí. Hotové lekce si klient odškrtává sám.
            </CardDescription>
          </div>
          {jeAdmin && (
            <ObsahDialog druh="lekce" skryte={{ courseId: kurz.id }} ulozit={ulozLekci} />
          )}
        </CardHeader>
        <CardContent>
          {kurz.lekce.length === 0 ? (
            <EmptyState
              icon={ListOrdered}
              title="Kurz zatím nemá žádnou lekci."
              description={jeAdmin ? "Přidej první tlačítkem Nová lekce." : undefined}
            />
          ) : (
            <ol className="divide-border divide-y rounded-md border">
              {kurz.lekce.map((lekce, poradi) => {
                // Kvíz u lekce (5C): otázky vidí každý, mění jen administrátor.
                const otazky =
                  lekce.kviz && !lekce.kviz.deletedAt ? prectiOtazky(lekce.kviz.questions) : null;
                const hodnoceniLekce = hodnoceni.get(lekce.id);
                // Postupné odemykání (5C): vidí každý, nastavuje administrátor.
                const odemceni = popisPravidla(lekce);
                return (
                  <li
                    key={lekce.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="text-muted-foreground w-6 shrink-0 text-right font-mono text-sm">
                      {poradi + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{lekce.title}</p>
                      <p className="text-muted-foreground line-clamp-1 text-xs">
                        {lekce.videoUrl && (
                          <Video
                            className="mr-1 inline size-3.5 align-[-2px]"
                            aria-label="s videem"
                          />
                        )}
                        {lekce.body.slice(0, 160) || "jen video"}
                      </p>
                      {otazky && (
                        <p className="text-muted-foreground text-xs">
                          Kvíz · {pocet(otazky.length, "otázka", "otázky", "otázek")}
                        </p>
                      )}
                      {odemceni && (
                        <p className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Lock className="size-3.5" aria-hidden />
                          {odemceni}
                        </p>
                      )}
                      <p className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Star className="size-3.5" aria-hidden />
                        {hodnoceniLekce
                          ? `Hodnocení ${formatPrumer(hodnoceniLekce.prumer)} z ${NEJVIC_HVEZD} · ${pocet(hodnoceniLekce.pocet, "hodnocení", "hodnocení", "hodnocení")}`
                          : "Zatím bez hodnocení"}
                      </p>
                    </div>
                    {!jeAdmin && otazky && (
                      <KvizDialog lekceId={lekce.id} lekce={lekce.title} otazky={otazky} jenCteni />
                    )}
                    {jeAdmin && (
                      <div className="flex shrink-0 items-center">
                        <KvizDialog lekceId={lekce.id} lekce={lekce.title} otazky={otazky} />
                        {otazky && (
                          <SmazaniObsahu
                            maly
                            titulek="Smazat kvíz"
                            nazev={`kvíz u lekce ${lekce.title}`}
                            dusledky="Klienti ho přestanou vidět. Kdo ho už splnil, tomu splnění i certifikát zůstanou."
                            smazat={smazKviz.bind(null, lekce.id)}
                          />
                        )}
                        <PosunLekce
                          id={lekce.id}
                          nazev={lekce.title}
                          prvni={poradi === 0}
                          posledni={poradi === kurz.lekce.length - 1}
                        />
                        <ObsahDialog
                          druh="lekce"
                          skryte={{ courseId: kurz.id, id: lekce.id }}
                          obsah={{
                            title: lekce.title,
                            body: lekce.body,
                            videoUrl: lekce.videoUrl ?? "",
                            odemceni: {
                              dni: lekce.unlockAfterDays ? String(lekce.unlockAfterDays) : "",
                              od: lekce.unlockOn ? jakoDen(lekce.unlockOn) : "",
                              poPredchozi: lekce.unlockAfterPrevious,
                            },
                          }}
                          ulozit={ulozLekci}
                        />
                        <SmazaniObsahu
                          maly
                          titulek="Smazat lekci"
                          nazev={lekce.title}
                          dusledky="Zmizí z kurzu i u klientů, kteří ji mají hotovou."
                          smazat={smazLekci.bind(null, lekce.id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
