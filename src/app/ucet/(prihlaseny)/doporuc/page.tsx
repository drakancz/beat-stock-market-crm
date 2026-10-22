import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDatum, formatMoney } from "@/lib/format";
import { nactiDoporuceniKlienta } from "@/lib/klient/doporuceni";
import { requireKlient } from "@/lib/klient/sezeni";
import { pocet } from "@/lib/mnozne";

export const metadata: Metadata = { title: "Doporuč přítele" };

export const dynamic = "force-dynamic";

/**
 * Doporuč přítele (Jakub, 19. 10. 2026) — **jen klient zapsaný jako
 * doporučitel**, ostatním 404. Kód, sleva pro kamaráda, procento odměny,
 * počet přivedených (bez jmen) a součty odměn. Odměny vyplácí tým ručně.
 */
export default async function DoporucPritelePage() {
  const klient = await requireKlient();
  const doporuceni = await nactiDoporuceniKlienta(klient.clientId);
  if (!doporuceni) notFound();

  const procento = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(
    doporuceni.procento,
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Doporuč přítele</h1>

      <Card>
        <CardHeader>
          <CardTitle>Váš kód</CardTitle>
          <CardDescription>
            Pošlete ho kamarádovi — při objednávce na webu ho zadá a dostane slevu. Vy dostanete{" "}
            {procento} % z jeho první zaplacené objednávky (bez DPH).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doporuceni.kody.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Teď nemáte žádný platný kód. Ozvěte se nám a připravíme vám nový.
            </p>
          ) : (
            <ul className="space-y-3">
              {doporuceni.kody.map((kod) => (
                <li
                  key={kod.kod}
                  data-testid="kod-doporucitele"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="bg-muted rounded-md px-3 py-1.5 font-mono text-lg font-semibold tracking-wider break-all select-all">
                    {kod.kod}
                  </span>
                  <span className="text-sm">{kod.sleva} pro kamaráda</span>
                  {kod.vycerpany ? (
                    <Badge variant="outline">Vyčerpaný</Badge>
                  ) : (
                    kod.platiDo && (
                      <span className="text-muted-foreground text-xs">
                        platí do {formatDatum(kod.platiDo)} včetně
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Co už se povedlo</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Přivedli jste</dt>
              <dd className="text-lg font-semibold" data-testid="privedeno">
                {pocet(doporuceni.privedeno, "nového klienta", "nové klienty", "nových klientů")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Čeká na vyplacení</dt>
              <dd className="text-lg font-semibold tabular-nums" data-testid="ceka-na-vyplatu">
                {formatMoney(doporuceni.cekaNaVyplatu.castka, "CZK")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Vyplaceno</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatMoney(doporuceni.vyplaceno.castka, "CZK")}
              </dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">
            Odměna vzniká, když kamarád svou první objednávku zaplatí. Vyplácíme ji ručně.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
