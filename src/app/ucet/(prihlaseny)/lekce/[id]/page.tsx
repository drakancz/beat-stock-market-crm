import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, House, Lock } from "lucide-react";

import { ObsahVzdelavani } from "@/components/vzdelavani/obsah";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireKlient } from "@/lib/klient/sezeni";
import { idZAdresy } from "@/lib/parametry";
import { MAX_DOTAZ, nactiDotazyKlienta } from "@/lib/vzdelavani/dotazy";
import { hodnoceniKlientaULekce, NEJVIC_HVEZD } from "@/lib/vzdelavani/hodnoceni";
import { nactiLekciKlienta } from "@/lib/vzdelavani/klient";
import { nactiKvizKlienta, PRAH_KVIZU } from "@/lib/vzdelavani/kvizy";

import { DotazyLekce } from "./dotazy";
import { HodnoceniLekce } from "./hodnoceni";
import { HotovoLekce } from "./hotovo";
import { KvizLekce } from "./kviz";

export const metadata: Metadata = { title: "Lekce" };

export const dynamic = "force-dynamic";

/**
 * Jedna lekce: video, text, Hotovo a přechod na další (krok 3C).
 *
 * Adresa je `/ucet/lekce/[id]`, ne `/ucet/kurzy/[kurz]/[lekce]` —
 * vývojový server Next.js 16.3 dvě proměnné části za sebou občas
 * nenašel (404 v testech, 4. 10. 2026). Kurz se dohledá z lekce; lekce
 * v kurzu, který klient nemá zaplacený, je 404.
 */
export default async function LekceKlientaPage({ params }: PageProps<"/ucet/lekce/[id]">) {
  const klient = await requireKlient();
  const lekceId = idZAdresy((await params).id);
  if (!lekceId) notFound();

  const nalezena = await nactiLekciKlienta(klient.clientId, lekceId);
  if (!nalezena) notFound();
  const { kurz, poradi } = nalezena;

  const lekce = kurz.lekce[poradi]!;
  const predchozi = kurz.lekce[poradi - 1];
  const dalsi = kurz.lekce[poradi + 1];
  // Kvíz pod lekcí (5C) — bez správných odpovědí, ty zná jen server.
  const [kviz, hodnoceni, dotazy] = await Promise.all([
    nactiKvizKlienta(klient.clientId, lekce.id),
    // Hodnocení lekce (5C, 18. 10. 2026) — jen to klientovo.
    hodnoceniKlientaULekce(klient.clientId, lekce.id),
    // Dotazy u lekce (5C, 18. 10. 2026) — jen klientovy.
    nactiDotazyKlienta(klient.clientId, lekce.id),
  ]);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/ucet/kurzy/${kurz.id}`}>
          <ArrowLeft />
          {kurz.title}
        </Link>
      </Button>

      <div>
        <p className="text-muted-foreground text-sm">
          Lekce {poradi + 1} z {kurz.lekce.length}
        </p>
        <h1 className="text-2xl font-semibold">{lekce.title}</h1>
      </div>

      <Card>
        <CardContent>
          <ObsahVzdelavani text={lekce.body} videoUrl={lekce.videoUrl} nazev={lekce.title} />
        </CardContent>
      </Card>

      {kviz && <KvizLekce lekceId={lekce.id} kurzId={kurz.id} kviz={kviz} prah={PRAH_KVIZU} />}

      <HodnoceniLekce lekceId={lekce.id} hodnoceni={hodnoceni} nejvic={NEJVIC_HVEZD} />

      <DotazyLekce lekceId={lekce.id} dotazy={dotazy} maxZnaku={MAX_DOTAZ} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <HotovoLekce lekceId={lekce.id} hotovo={lekce.hotovo} />
        <div className="flex flex-wrap gap-2">
          {predchozi && (
            <Button asChild variant="outline">
              <Link href={`/ucet/lekce/${predchozi.id}`}>
                <ArrowLeft />
                Předchozí
              </Link>
            </Button>
          )}
          {dalsi?.zamcena ? (
            // Další lekce je zamčená (5C, 18. 10. 2026) — jen kdy se otevře.
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Lock className="size-4 shrink-0" aria-hidden />
              Další lekce: {dalsi.zamcena}
            </p>
          ) : dalsi ? (
            <Button asChild variant="outline">
              <Link href={`/ucet/lekce/${dalsi.id}`}>
                Další lekce
                <ArrowRight />
              </Link>
            </Button>
          ) : (
            // Poslední lekce (Jakub, 5. 10. 2026): zpátky na přehled
            // s odznaky, ať se klient nemusí proklikávat lekcemi zpět.
            <Button asChild variant="outline">
              <Link href="/ucet">
                <House />
                Domů
              </Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
