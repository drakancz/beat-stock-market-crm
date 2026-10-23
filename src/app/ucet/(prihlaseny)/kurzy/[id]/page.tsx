import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, CheckCircle2, Circle, Download, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { pocet } from "@/lib/mnozne";
import { idZAdresy } from "@/lib/parametry";
import { coChybiKCertifikatu } from "@/lib/vzdelavani/certifikaty";
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
  // Zamčené lekce (5C) tlačítko nenabídne; když zbývají jen ty, žádné není.
  const dalsi =
    hotovo === kurz.lekce.length
      ? kurz.lekce[0]
      : kurz.lekce.find((lekce) => !lekce.hotovo && !lekce.zamcena);
  // Certifikát (5C): stažení, nebo co k němu ještě chybí.
  const [certifikat, chybi] = await Promise.all([
    db.courseCertificate.findUnique({
      where: { clientId_courseId: { clientId: klient.clientId, courseId: kurz.id } },
      select: { id: true, number: true, issuedAt: true },
    }),
    coChybiKCertifikatu(klient.clientId, kurz.id),
  ]);

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

      {certifikat ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <Award className="text-primary size-8 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Certifikát o absolvování kurzu</p>
              <p className="text-muted-foreground text-sm">
                <span className="font-mono">{certifikat.number}</span> · vydaný{" "}
                {formatDatum(certifikat.issuedAt)}
              </p>
            </div>
            <Button asChild variant="outline">
              <a href={`/ucet/certifikat/${certifikat.id}`} download>
                <Download />
                Stáhnout certifikát (PDF)
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        chybi && (
          <p className="text-muted-foreground text-sm">
            <Award className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
            Certifikát dostanete, až budete mít hotové všechny lekce a splněné kvízy.
            {chybi.lekciZbyva > 0 &&
              ` ${chybi.lekciZbyva >= 2 && chybi.lekciZbyva <= 4 ? "Zbývají" : "Zbývá"} ${pocet(chybi.lekciZbyva, "lekce", "lekce", "lekcí")}.`}
            {chybi.kvizyZbyva.length > 0 &&
              ` Nesplněné kvízy u lekcí: ${chybi.kvizyZbyva.join(", ")}.`}
          </p>
        )
      )}

      <Card>
        <CardContent>
          {kurz.lekce.length === 0 ? (
            <p className="text-muted-foreground text-sm">Lekce kurzu připravujeme.</p>
          ) : (
            <ol className="divide-border divide-y">
              {kurz.lekce.map((lekce, poradi) =>
                lekce.zamcena ? (
                  // Zamčená lekce (5C, 18. 10. 2026): jen název a kdy se otevře.
                  <li
                    key={lekce.id}
                    className="text-muted-foreground -mx-2 flex items-center gap-3 px-2 py-2.5 text-sm"
                  >
                    <Lock className="size-5 shrink-0" aria-label="zamčená" />
                    <span className="w-6 shrink-0 text-right font-mono">{poradi + 1}.</span>
                    <span className="min-w-0 flex-1">
                      {lekce.title}
                      <span className="block text-xs">{lekce.zamcena}</span>
                    </span>
                  </li>
                ) : (
                  <li key={lekce.id}>
                    <Link
                      href={`/ucet/lekce/${lekce.id}`}
                      className="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm"
                    >
                      {lekce.hotovo ? (
                        <CheckCircle2
                          className="text-primary size-5 shrink-0"
                          aria-label="hotovo"
                        />
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
                      {lekce.kviz && (
                        <Badge variant={lekce.kviz.splneno ? "secondary" : "outline"}>
                          {lekce.kviz.splneno ? "kvíz splněný" : "kvíz"}
                        </Badge>
                      )}
                    </Link>
                  </li>
                ),
              )}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
