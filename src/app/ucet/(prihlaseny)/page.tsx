import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SeznamOdznaku } from "@/components/vzdelavani/odznaky";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDatum, formatMoney, formatTelefon } from "@/lib/format";
import { nactiPrehledKlienta, type ProduktKlienta } from "@/lib/klient/data";
import { requireKlient } from "@/lib/klient/sezeni";
import { nactiOdznaky } from "@/lib/vzdelavani/odznaky";
import { ORDER_STATUS_LABEL } from "@/lib/types";

export const metadata: Metadata = { title: "Přehled" };

export const dynamic = "force-dynamic";

/**
 * Přehled klientské části (krok 3A, část 2, Jakub 30. 9. 2026).
 *
 * **Vidí jen přihlášený klient, a jen sebe:** členství a produkty,
 * přístup do programu, objednávky a svoje údaje. Data se berou podle
 * `klient.clientId` z přihlášení (`src/lib/klient/data.ts`).
 *
 * Ceny jsou **s DPH** — to klient platil. Ceny bez DPH, poznámky týmu,
 * hovory ani nic dalšího z CRM se sem nedostane.
 */
export default async function UcetPage() {
  const klient = await requireKlient();
  const [prehled, odznaky] = await Promise.all([
    nactiPrehledKlienta(klient.clientId),
    nactiOdznaky(klient.clientId),
  ]);
  // Karta mezitím zmizela — `requireKlient()` by příště stejně odhlásil.
  if (!prehled) notFound();

  const { udaje, objednavky, produkty } = prehled;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Dobrý den, {udaje.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tady najdete svoje objednávky, členství a údaje, které u nás máte.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Členství a produkty</CardTitle>
          <CardDescription>Co máte zaplacené a do kdy vám to platí.</CardDescription>
        </CardHeader>
        <CardContent>
          {produkty.length === 0 ? (
            <p className="text-muted-foreground text-sm">Zatím nemáte nic zaplaceného.</p>
          ) : (
            <ul className="divide-border divide-y" aria-label="Členství a produkty">
              {produkty.map((produkt) => (
                <li
                  key={produkt.productId}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 font-medium break-words">{produkt.name}</span>
                  <span
                    className={
                      produkt.skoncilo ? "text-muted-foreground text-sm" : "text-sm font-medium"
                    }
                  >
                    {popisPlatnosti(produkt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Přístup do programu</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {udaje.programAccess === "POVOLEN" ? (
            <p>
              <Badge>Povolen</Badge>
              <span className="text-muted-foreground ml-2">Do programu máte přístup.</span>
            </p>
          ) : (
            <p>
              <Badge variant="outline">Zatím nepovolen</Badge>
              <span className="text-muted-foreground ml-2">
                Přístup povolujeme po zaplacení objednávky.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Odznaky za vzdělávání a aktivitu (krok 3C) — nikdy za obchody. */}
      <Card>
        <CardHeader>
          <CardTitle>Moje odznaky</CardTitle>
          <CardDescription>Za lekce, kurzy, webináře a pravidelnou aktivitu.</CardDescription>
        </CardHeader>
        <CardContent>
          {odznaky.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Zatím žádný. První získáte za dokončenou lekci v{" "}
              <Link href="/ucet/kurzy" className="text-primary underline-offset-4 hover:underline">
                Kurzech
              </Link>
              .
            </p>
          ) : (
            <SeznamOdznaku odznaky={odznaky} sPopisem />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moje objednávky</CardTitle>
          <CardDescription>Ceny jsou včetně DPH.</CardDescription>
        </CardHeader>
        <CardContent>
          {objednavky.length === 0 ? (
            <p className="text-muted-foreground text-sm">Zatím žádná objednávka.</p>
          ) : (
            <ul className="divide-border divide-y" aria-label="Moje objednávky">
              {objednavky.map((objednavka) => (
                <li key={objednavka.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tabular min-w-0 flex-1 font-medium">
                      Objednávka {objednavka.number}
                    </span>
                    <Badge variant={objednavka.status === "ZAPLACENO" ? "default" : "outline"}>
                      {ORDER_STATUS_LABEL[objednavka.status]}
                    </Badge>
                    <span className="tabular font-medium whitespace-nowrap">
                      {formatMoney(objednavka.celkemSDph, objednavka.currency)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDatum(objednavka.createdAt)}
                    {objednavka.paidAt && ` · zaplaceno ${formatDatum(objednavka.paidAt)}`}
                  </p>
                  <ul className="text-muted-foreground space-y-0.5 text-sm">
                    {objednavka.polozky.map((polozka, index) => (
                      <li key={index} className="flex justify-between gap-3">
                        <span className="min-w-0 break-words">
                          {polozka.name}
                          {polozka.quantity > 1 && ` (${polozka.quantity}×)`}
                        </span>
                        <span className="tabular whitespace-nowrap">
                          {formatMoney(polozka.quantity * polozka.cenaSDph, objednavka.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moje údaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Radek popisek="Jméno" hodnota={udaje.name} />
          <Radek popisek="E-mail" hodnota={udaje.email} />
          <Radek popisek="Telefon" hodnota={udaje.phone ? formatTelefon(udaje.phone) : "—"} />
          <Radek
            popisek="Souhlas se zasíláním novinek"
            hodnota={
              udaje.consentMarketingAt
                ? `Udělen ${formatDatum(udaje.consentMarketingAt)}`
                : "Neudělen"
            }
          />
          <Button asChild variant="outline" size="sm">
            <Link href="/ucet/profil">Upravit údaje a heslo</Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

function popisPlatnosti(produkt: ProduktKlienta): string {
  if (produkt.do) {
    return produkt.skoncilo
      ? `skončilo ${formatDatum(produkt.do)}`
      : `platí do ${formatDatum(produkt.do)} včetně`;
  }
  return produkt.kind === "KONZULTACE" ? "jednorázová služba" : "neomezeně";
}

function Radek({ popisek, hodnota }: { popisek: string; hodnota: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="text-muted-foreground text-xs">{popisek}</span>
      <span className="font-medium break-all">{hodnota}</span>
    </div>
  );
}
