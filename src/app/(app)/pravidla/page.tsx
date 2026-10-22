import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { nactiPravidla } from "@/lib/pravidla";
import { POPIS_PRAVIDLA, PRAVIDLA } from "@/lib/pravidla-druhy";
import { requireViewer } from "@/lib/session";
import { nactiStitky } from "@/lib/stitky";

import { FormularPravidla } from "./formular-pravidla";
import { VlastniPravidla } from "./vlastni-pravidla";

export const metadata: Metadata = { title: "Pravidla" };

export const dynamic = "force-dynamic";

/**
 * Pravidla „když se stane X, udělej Y“ (Fáze 5D, Jakub 18. 10. 2026).
 *
 * **Vidí každý přihlášený, mění jen administrátor.** Proto vlastní stránka,
 * ne Nastavení — to je celé jen pro administrátora. Uživatel vidí, co běží,
 * komu a kolikrát se to stalo; formuláře dostane jen administrátor
 * a `ulozPravidlo()` to hlídá znovu.
 */
export default async function PravidlaPage() {
  const viewer = await requireViewer();
  const jeAdmin = viewer.role === "ADMINISTRATOR";

  const [pravidla, produkty, stitky] = await Promise.all([
    nactiPravidla(),
    jeAdmin
      ? db.product.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    jeAdmin ? nactiStitky() : Promise.resolve([]),
  ]);
  const podleId = new Map(pravidla.map((pravidlo) => [pravidlo.id, pravidlo]));

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Pravidla</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Když se stane tohle, CRM samo udělá tamto. Ranní pravidla běží každé ráno s plánovačem,
          štítek po zaplacení hned. Každá akce proběhne u klienta jen jednou.
          {!jeAdmin && " Zapnout a nastavit je může administrátor."}
        </p>
      </div>

      {PRAVIDLA.map((id) => {
        const pravidlo = podleId.get(id);
        if (!pravidlo) return null;
        const popis = POPIS_PRAVIDLA[id];
        return (
          <Card key={id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">{popis.nazev}</CardTitle>
                <Badge variant={pravidlo.enabled ? "default" : "secondary"}>
                  {pravidlo.enabled ? "Zapnuto" : "Vypnuto"}
                </Badge>
              </div>
              <CardDescription className="space-y-1">
                <span className="block">
                  <span className="text-foreground font-medium">Když: </span>
                  {popis.kdy}
                </span>
                <span className="block">
                  <span className="text-foreground font-medium">Udělá: </span>
                  {popis.co}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                {shrnuti(pravidlo)}
                {" · "}
                proběhlo {pravidlo.provedeno}×
              </p>
              {jeAdmin && (
                <FormularPravidla
                  pravidlo={{
                    id,
                    nazev: popis.nazev,
                    enabled: pravidlo.enabled,
                    dvojice: pravidlo.dvojice.map((d) => ({
                      productId: d.productId,
                      tagId: d.tagId,
                    })),
                    messageTitle: pravidlo.messageTitle,
                    messageText: pravidlo.messageText,
                  }}
                  produkty={produkty}
                  stitky={stitky.map((stitek) => ({ id: stitek.id, name: stitek.name }))}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
      {/* Vlastní pravidla (5D, 2. část, 19. 10. 2026). */}
      <VlastniPravidla jeAdmin={jeAdmin} />
    </>
  );
}

/** Co je u pravidla nastavené — slovy, i pro uživatele bez formuláře. */
function shrnuti(pravidlo: Awaited<ReturnType<typeof nactiPravidla>>[number]): string {
  switch (pravidlo.id) {
    case "nechodi-zprava":
      return pravidlo.messageTitle ? `Zpráva „${pravidlo.messageTitle}“` : "Zpráva bez textu";
    case "lekce-oznameni":
      return "Oznámení na telefon, jinak e-mail";
    case "zaplaceno-stitek":
      return pravidlo.dvojice.length > 0
        ? pravidlo.dvojice.map((d) => `${d.product.name} → ${d.tag.name}`).join(" · ")
        : "Žádný produkt se štítkem";
    default:
      return "";
  }
}
