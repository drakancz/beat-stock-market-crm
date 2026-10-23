import type { Metadata } from "next";
import { z } from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { sDph } from "@/lib/dph";
import { formatMoney } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { pocet } from "@/lib/mnozne";
import { precti, textParam, type Parametry } from "@/lib/parametry";
import { ibanZCislaUctu } from "@/lib/platby/prevod";
import { branaZapnuta } from "@/lib/platby/platby";
import type { ProductKind } from "@/generated/prisma/enums";

import { KoupitProdukt } from "./koupit-produkt";

export const metadata: Metadata = { title: "Koupit" };

export const dynamic = "force-dynamic";

const PORADI_DRUHU: ProductKind[] = ["CLENSTVI", "KURZ", "KONZULTACE"];

const NADPIS_DRUHU: Record<ProductKind, string> = {
  CLENSTVI: "Členství",
  KURZ: "Kurzy",
  KONZULTACE: "Konzultace",
};

function popisProduktu(kind: ProductKind, mesicu: number | null): string {
  if (kind === "KURZ") return "Kurz s neomezeným přístupem";
  if (kind === "KONZULTACE") return "Jednorázová konzultace";
  return mesicu
    ? `Členství na ${pocet(mesicu, "měsíc", "měsíce", "měsíců")}, navazuje na stávající`
    : "Členství bez omezení";
}

/**
 * Koupit (Jakub, 20. 10. 2026): klient si sám prodlouží členství nebo
 * dokoupí kurz či konzultaci. **Jen přihlášený klient a jen za sebe.**
 * Nabízí se prodávané a nesmazané produkty z ceníku, ceny s DPH.
 *
 * Zaplatí převodem (číslo účtu z Nastavení → Firma, QR platba), nebo
 * kartou, když je zapnutá brána. Bez účtu i bez brány nákup zaplatit nejde
 * — stránka pak jen ukáže nabídku a kontakt.
 */
export default async function KoupitPage({ searchParams }: PageProps<"/ucet/koupit">) {
  const klient = await requireKlient();
  // Odkaz „Prodloužit“ z Přehledu otevře rovnou okno daného produktu.
  const { produkt: vybrany } = precti(
    z.object({ produkt: textParam(64) }),
    (await searchParams) as Parametry,
  );

  const [produkty, firma, platnosti] = await Promise.all([
    db.product.findMany({
      where: { active: true, deletedAt: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        netPrice: true,
        currency: true,
        validityMonths: true,
        vatRate: { select: { rate: true } },
      },
    }),
    db.companySettings.findUnique({
      where: { id: "firma" },
      select: { bankAccount: true, contactEmail: true },
    }),
    db.productValidity.findMany({
      where: { clientId: klient.clientId, validUntil: { not: null } },
      select: { productId: true },
    }),
  ]);

  const prevodem = !!firma?.bankAccount && !!ibanZCislaUctu(firma.bankAccount);
  const lzeZaplatit = prevodem || branaZapnuta();
  const maPlatnost = new Set(platnosti.map((p) => p.productId));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Koupit</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Prodloužení členství, kurzy a konzultace. Ceny jsou včetně DPH.
        </p>
      </div>

      {!lzeZaplatit && (
        <Card>
          <CardContent className="text-sm">
            Nákup přímo tady zatím nejde zaplatit. Napište nám
            {firma?.contactEmail ? (
              <>
                {" "}
                na{" "}
                <a className="text-primary underline" href={`mailto:${firma.contactEmail}`}>
                  {firma.contactEmail}
                </a>
              </>
            ) : null}{" "}
            a domluvíme se.
          </CardContent>
        </Card>
      )}

      {produkty.length === 0 && (
        <p className="text-muted-foreground text-sm">Teď nic v nabídce nemáme.</p>
      )}

      {PORADI_DRUHU.map((druh) => {
        const vDruhu = produkty.filter((produkt) => produkt.kind === druh);
        if (vDruhu.length === 0) return null;
        return (
          <Card key={druh}>
            <CardHeader>
              <CardTitle>{NADPIS_DRUHU[druh]}</CardTitle>
              {druh === "CLENSTVI" && (
                <CardDescription>
                  Prodloužení navazuje na konec stávajícího členství — o zaplacené dny nepřijdete.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y" aria-label={NADPIS_DRUHU[druh]}>
                {vDruhu.map((produkt) => {
                  const cena = sDph(Number(produkt.netPrice), Number(produkt.vatRate.rate));
                  const prodlouzit = druh === "CLENSTVI" && maPlatnost.has(produkt.id);
                  return (
                    <li
                      key={produkt.id}
                      data-testid="produkt-k-nakupu"
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
                    >
                      {/* Na telefonu název přes celý řádek, cena a tlačítko pod ním —
                          vedle nich by se název lámal po slovech. */}
                      <div className="min-w-0 basis-full sm:flex-1">
                        <p className="font-medium break-words">{produkt.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {popisProduktu(produkt.kind, produkt.validityMonths)}
                        </p>
                      </div>
                      <span className="tabular mr-auto font-medium whitespace-nowrap sm:mr-0">
                        {formatMoney(cena, produkt.currency)}
                      </span>
                      <KoupitProdukt
                        produkt={{
                          id: produkt.id,
                          nazev: produkt.name,
                          cena,
                          mena: produkt.currency,
                        }}
                        tlacitko={prodlouzit ? "Prodloužit" : "Koupit"}
                        lzeZaplatit={lzeZaplatit}
                        otevrit={vybrany === produkt.id}
                      />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
