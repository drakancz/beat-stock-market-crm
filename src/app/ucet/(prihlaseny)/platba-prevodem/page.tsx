import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { cenaPolozkySDph } from "@/lib/dph";
import { formatMoney } from "@/lib/format";
import { requireKlient } from "@/lib/klient/sezeni";
import { precti, textParam, type Parametry } from "@/lib/parametry";
import { branaZapnuta } from "@/lib/platby/platby";
import { ibanZCislaUctu, qrSvg, textQrPlatby, variabilniSymbol } from "@/lib/platby/prevod";

import { Zaplatit } from "../zaplatit";

export const metadata: Metadata = { title: "Platba převodem" };

export const dynamic = "force-dynamic";

/**
 * Platba převodem (Jakub, 20. 10. 2026): číslo účtu, variabilní symbol,
 * částka a QR platba k **vlastní** nezaplacené objednávce — hledá se
 * podle čísla **a** `clientId` z přihlášení, cizí objednávka je 404.
 * Zaplaceno přepne administrátor, až platba dorazí.
 */
export default async function PlatbaPrevodemPage({
  searchParams,
}: PageProps<"/ucet/platba-prevodem">) {
  const klient = await requireKlient();
  const { cislo } = precti(z.object({ cislo: textParam(20) }), (await searchParams) as Parametry);
  if (!cislo) notFound();

  const [objednavka, firma] = await Promise.all([
    db.order.findFirst({
      where: { number: cislo, clientId: klient.clientId, deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        items: {
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: { select: { netPrice: true, vatRate: { select: { rate: true } } } },
          },
        },
      },
    }),
    db.companySettings.findUnique({
      where: { id: "firma" },
      select: { bankAccount: true, companyName: true, contactEmail: true },
    }),
  ]);
  if (!objednavka) notFound();

  const celkem = objednavka.items.reduce(
    (soucet, polozka) => soucet + polozka.quantity * cenaPolozkySDph(polozka),
    0,
  );
  const zaplaceno = objednavka.status === "ZAPLACENO";
  const iban = firma?.bankAccount ? ibanZCislaUctu(firma.bankAccount) : null;
  const vs = variabilniSymbol(objednavka.number);
  const qr =
    iban && !zaplaceno
      ? qrSvg(
          textQrPlatby({
            iban,
            castka: celkem,
            mena: objednavka.currency,
            vs,
            zprava: `Objednavka ${objednavka.number}`,
          }),
        )
      : null;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Objednávka {objednavka.number}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {zaplaceno ? (
            <Badge>Zaplaceno</Badge>
          ) : (
            "Děkujeme. Objednávka platí, jakmile k nám dorazí platba."
          )}
        </p>
      </div>

      {!zaplaceno && (
        <Card>
          <CardHeader>
            <CardTitle>Platba převodem</CardTitle>
            <CardDescription>
              Naskenujte QR kód v bankovní aplikaci, nebo zadejte platbu ručně. Jakmile platba
              dorazí, objednávku označíme jako zaplacenou a dáme vám vědět.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {iban && firma?.bankAccount ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {qr && (
                  <div
                    className="bg-qr-pozadi text-qr-popredi w-48 shrink-0 rounded-md p-2 [&>svg]:h-auto [&>svg]:w-full"
                    role="img"
                    aria-label="QR platba"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                )}
                <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Částka</dt>
                  <dd className="tabular font-medium" data-testid="castka">
                    {formatMoney(celkem, objednavka.currency)}
                  </dd>
                  <dt className="text-muted-foreground">Číslo účtu</dt>
                  <dd className="tabular break-all">{firma.bankAccount}</dd>
                  <dt className="text-muted-foreground">IBAN</dt>
                  <dd className="tabular break-all">{iban}</dd>
                  <dt className="text-muted-foreground">Variabilní symbol</dt>
                  <dd className="tabular" data-testid="vs">
                    {vs}
                  </dd>
                  <dt className="text-muted-foreground">Příjemce</dt>
                  <dd className="break-words">{firma.companyName}</dd>
                </dl>
              </div>
            ) : (
              <p className="text-sm">
                Údaje k platbě vám pošleme. Kdyby nedorazily, napište nám
                {firma?.contactEmail ? ` na ${firma.contactEmail}` : ""}.
              </p>
            )}
            {branaZapnuta() && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">Nebo kartou:</span>
                <Zaplatit orderId={objednavka.id} cislo={objednavka.number} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-sm">
        <Link href="/ucet" className="text-primary underline-offset-4 hover:underline">
          Zpět na přehled
        </Link>
      </p>
    </>
  );
}
