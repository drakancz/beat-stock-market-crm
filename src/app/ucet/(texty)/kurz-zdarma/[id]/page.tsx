import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Lock, PlayCircle } from "lucide-react";

import { ObsahVzdelavani } from "@/components/vzdelavani/obsah";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getKlient } from "@/lib/klient/sezeni";
import { pocet } from "@/lib/mnozne";
import { idZAdresy } from "@/lib/parametry";
import { nactiKurzZdarma } from "@/lib/vzdelavani/kurz-zdarma";
import { kurzyKlienta } from "@/lib/vzdelavani/pristup";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/ucet/kurz-zdarma/[id]">): Promise<Metadata> {
  const id = idZAdresy((await params).id);
  const kurz = id ? await nactiKurzZdarma(id) : null;
  return { title: kurz ? `Ukázka zdarma: ${kurz.title}` : "Ukázka kurzu" };
}

/**
 * Minikurz zdarma (Platforma B, Jakub 5. 11. 2026) — veřejná ukázka kurzu.
 *
 * **Vidí i nepřihlášený** (zapsané v security.md, adresy bez přihlášení).
 * Ukáže text a video lekcí, které administrátor označil jako zdarma;
 * ostatní lekce jen názvem se zámkem. Kvíz, materiály, odškrtnutí ani
 * nic o klientech tu není. Kurz bez lekce zdarma, koncept i smazaný = 404.
 *
 * Přihlášený klient s kurzem dostane odkaz do kurzu, přihlášený bez něj
 * Koupit v klientské části; nepřihlášený odkaz na stránku kurzu na webu.
 */
export default async function KurzZdarmaPage({ params }: PageProps<"/ucet/kurz-zdarma/[id]">) {
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const kurz = await nactiKurzZdarma(id);
  if (!kurz) notFound();

  const klient = await getKlient();
  const maKurz = klient
    ? (await db.course.count({
        where: { AND: [{ id: kurz.id }, kurzyKlienta(klient.clientId)] },
      })) > 0
    : false;

  const zdarma = kurz.lekce.filter((lekce) => lekce.obsah).length;

  const nabidka = (
    <div className="bg-muted/50 flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <p className="min-w-0 flex-1 text-sm">
        {maKurz
          ? "Tenhle kurz už máte — celý ho najdete v klientské části."
          : `Celý kurz má ${pocet(kurz.lekce.length, "lekci", "lekce", "lekcí")}, s kvízy, materiály ke stažení a certifikátem.`}
      </p>
      {maKurz ? (
        <Button asChild>
          <Link href={`/ucet/kurzy/${kurz.id}`}>Přejít do kurzu</Link>
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {klient && kurz.productId && (
            <Button asChild>
              <Link href={`/ucet/koupit?produkt=${kurz.productId}`}>Koupit kurz</Link>
            </Button>
          )}
          {kurz.url && (
            <Button asChild variant={klient && kurz.productId ? "outline" : "default"}>
              <a href={kurz.url} target="_blank" rel="noopener noreferrer">
                Více o kurzu
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <p className="text-primary text-sm font-medium">
          Ukázka zdarma · {pocet(zdarma, "lekce", "lekce", "lekcí")} z {kurz.lekce.length}
        </p>
        <h1 className="text-2xl font-semibold text-balance">{kurz.title}</h1>
        {kurz.description && <p className="text-muted-foreground">{kurz.description}</p>}
      </header>

      <nav aria-label="Lekce kurzu">
        <ol className="divide-border divide-y rounded-md border">
          {kurz.lekce.map((lekce, poradi) => (
            <li key={lekce.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground w-6 shrink-0 text-right font-mono">
                {poradi + 1}.
              </span>
              {lekce.obsah ? (
                <a
                  href={`#lekce-${lekce.id}`}
                  className="flex min-h-6 min-w-0 flex-1 items-center gap-2 font-medium underline-offset-4 hover:underline"
                >
                  <PlayCircle className="text-primary size-4 shrink-0" aria-hidden />
                  {lekce.title}
                  <span className="text-primary text-xs font-normal">zdarma</span>
                </a>
              ) : (
                <span className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2">
                  <Lock className="size-4 shrink-0" aria-hidden />
                  {lekce.title}
                  <span className="sr-only">(jen v celém kurzu)</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {kurz.lekce.map((lekce, poradi) =>
        lekce.obsah ? (
          <section
            key={lekce.id}
            id={`lekce-${lekce.id}`}
            aria-labelledby={`nadpis-${lekce.id}`}
            className="scroll-mt-6 space-y-3"
          >
            <div>
              <p className="text-muted-foreground text-sm">Lekce {poradi + 1}</p>
              <h2 id={`nadpis-${lekce.id}`} className="text-xl font-semibold">
                {lekce.title}
              </h2>
            </div>
            <ObsahVzdelavani
              text={lekce.obsah.body}
              videoUrl={lekce.obsah.videoUrl}
              nazev={lekce.title}
            />
          </section>
        ) : null,
      )}

      {nabidka}
    </article>
  );
}
