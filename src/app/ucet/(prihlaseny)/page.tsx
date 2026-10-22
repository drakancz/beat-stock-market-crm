import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Award, CalendarCheck, Download, Gift, Play } from "lucide-react";

import { MedaileOdznaku, pocetZiskanych } from "@/components/vzdelavani/medaile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDatum, formatDatumCas, formatMoney, formatTelefon } from "@/lib/format";
import { nactiPrehledKlienta, type ProduktKlienta } from "@/lib/klient/data";
import { nactiDoporuceniKlienta } from "@/lib/klient/doporuceni";
import { nactiKonzultaceKlienta } from "@/lib/konzultace";
import { branaZapnuta } from "@/lib/platby/platby";
import { prevodemZaplatitLze } from "@/lib/platby/prevod";
import { requireKlient } from "@/lib/klient/sezeni";
import { pocet } from "@/lib/mnozne";
import { nactiBodyAPoradi } from "@/lib/vzdelavani/body";
import { BODY } from "@/lib/vzdelavani/body-pravidla";
import { nactiCertifikaty } from "@/lib/vzdelavani/certifikaty";
import { nactiPokracovani } from "@/lib/vzdelavani/klient";
import { nactiAktivniTydny, nactiOdznaky, PORADI_ODZNAKU } from "@/lib/vzdelavani/odznaky";
import { ORDER_STATUS_LABEL } from "@/lib/types";

import { Zaplatit } from "./zaplatit";

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
  const [prehled, odznaky, pokracovani, aktivita, certifikaty, body, konzultace, doporuceni] =
    await Promise.all([
      nactiPrehledKlienta(klient.clientId),
      nactiOdznaky(klient.clientId),
      nactiPokracovani(klient.clientId),
      nactiAktivniTydny(klient.clientId),
      nactiCertifikaty(klient.clientId),
      // Body a pořadí (5C, 18. 10. 2026) — jen čísla, jména ostatních nikdy.
      nactiBodyAPoradi(klient.clientId),
      // Konzultace (5B, 19. 10. 2026) — karta jen se zaplacenou konzultací.
      nactiKonzultaceKlienta(klient.clientId),
      // Doporuč přítele (19. 10. 2026) — karta jen doporučitelům.
      nactiDoporuceniKlienta(klient.clientId),
    ]);
  // Karta mezitím zmizela — `requireKlient()` by příště stejně odhlásil.
  if (!prehled) notFound();

  const { udaje, objednavky, produkty } = prehled;
  // Platební brána (19. 10. 2026) — bez klíčů se tlačítko Zaplatit nekreslí.
  const platitOnline = branaZapnuta();
  // Platba převodem (20. 10. 2026) — jen když je v Nastavení → Firma účet.
  const platitPrevodem = await prevodemZaplatitLze();
  const maVytrvalost = odznaky.some((odznak) => odznak.kind === "AKTIVNI_4_TYDNY");

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Dobrý den, {udaje.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Vaše kurzy, odznaky, členství a objednávky.
        </p>
      </div>

      {/* Varianta B (Jakub, 10. 10. 2026): nahoře vždy, kde klient skončil. */}
      {pokracovani && (
        <section
          aria-label="Pokračovat v kurzu"
          className="bg-primary text-primary-foreground space-y-3 rounded-xl p-5 shadow-sm"
        >
          <p className="text-sm opacity-80">
            {pokracovani.hotovo === 0 ? "Začněte s kurzem" : "Pokračujte tam, kde jste skončili"}
          </p>
          <div>
            <p className="text-lg leading-snug font-semibold break-words">
              Lekce {pokracovani.poradi} · {pokracovani.lekce}
            </p>
            <p className="text-sm break-words opacity-80">
              {pokracovani.kurz} · {pokracovani.hotovo} z {pokracovani.lekci} lekcí
            </p>
          </div>
          <div
            className="bg-primary-foreground/25 h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Postup v kurzu"
            aria-valuemin={0}
            aria-valuemax={pokracovani.lekci}
            aria-valuenow={pokracovani.hotovo}
          >
            <div
              className="bg-primary-foreground h-full rounded-full"
              style={{ width: `${(pokracovani.hotovo / pokracovani.lekci) * 100}%` }}
            />
          </div>
          <Button asChild variant="secondary">
            <Link href={`/ucet/lekce/${pokracovani.lekceId}`}>
              <Play />
              {pokracovani.hotovo === 0 ? "Začít" : "Pokračovat"}
            </Link>
          </Button>
        </section>
      )}

      {konzultace.zaplaceno > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="text-primary size-5" aria-hidden />
              Konzultace
            </CardTitle>
            <CardDescription>
              {konzultace.pristi
                ? `Příští konzultace: ${formatDatumCas(konzultace.pristi)}.`
                : konzultace.zbyva > 0
                  ? `Máte ${pocet(konzultace.zbyva, "konzultaci", "konzultace", "konzultací")} k rezervaci.`
                  : "Všechny vaše konzultace už jsou využité."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/ucet/konzultace">
                {konzultace.zbyva > 0 ? "Vybrat termín" : "Moje konzultace"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {doporuceni && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="text-primary size-5" aria-hidden />
              Doporuč přítele
            </CardTitle>
            <CardDescription>
              {doporuceni.kody[0]
                ? `Váš kód ${doporuceni.kody[0].kod} dá kamarádovi slevu.`
                : "Doporučte nás a získejte odměnu."}{" "}
              Přivedli jste{" "}
              {pocet(doporuceni.privedeno, "nového klienta", "nové klienty", "nových klientů")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/ucet/doporuc">Kód a odměny</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Aktivní týdny</CardTitle>
            <Badge
              variant="outline"
              className="bg-pristup-ano text-pristup-ano-foreground border-0"
            >
              {aktivita.serie} {tvarTydnu(aktivita.serie)} v řadě
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="grid grid-cols-4 gap-1.5" aria-label="Poslední čtyři týdny">
            {aktivita.tydny.map((tyden) => (
              <li
                key={tyden.tyden}
                className={
                  tyden.byl
                    ? "bg-pristup-ano-foreground text-background rounded-md py-1 text-center text-xs font-medium tabular-nums"
                    : "bg-muted text-muted-foreground rounded-md border py-1 text-center text-xs tabular-nums"
                }
              >
                <span className="sr-only">Týden </span>
                {tyden.cislo}
                <span className="sr-only">{tyden.byl ? ": byli jste tu" : ": nebyli jste tu"}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground text-sm">
            {textAktivity(aktivita.serie, maVytrvalost)}
          </p>
        </CardContent>
      </Card>

      {/* Body a úroveň (Fáze 5C, 18. 10. 2026) — za vzdělávání a aktivitu, nikdy za obchody. */}
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle>Vaše body</CardTitle>
            <span className="text-primary text-2xl font-semibold tabular-nums">{body.body}</span>
          </div>
          <CardDescription>
            Úroveň <span className="text-foreground font-medium">{body.uroven.nazev}</span> · pořadí{" "}
            {body.poradi}. z {body.z}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {body.uroven.dalsi && (
            <div className="space-y-1.5">
              <div
                className="bg-muted h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-label={`Do úrovně ${body.uroven.dalsi.nazev}`}
                aria-valuemin={body.uroven.od}
                aria-valuemax={body.uroven.dalsi.od}
                aria-valuenow={body.body}
              >
                <div
                  className="bg-primary h-full rounded-full"
                  style={{
                    width: `${((body.body - body.uroven.od) / (body.uroven.dalsi.od - body.uroven.od)) * 100}%`,
                  }}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                Do úrovně {body.uroven.dalsi.nazev} zbývá{" "}
                {pocet(body.uroven.dalsi.od - body.body, "bod", "body", "bodů")}.
              </p>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Lekce {BODY.lekce} · splněný kvíz {BODY.kviz} · webinář {BODY.webinar} · aktivní týden{" "}
            {BODY.tyden} · certifikát {BODY.certifikat} bodů
          </p>
        </CardContent>
      </Card>

      {/* Odznaky za vzdělávání a aktivitu (krok 3C) — nikdy za obchody. */}
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle>Moje odznaky</CardTitle>
            <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
              {pocetZiskanych(odznaky)} z {PORADI_ODZNAKU.length}
            </span>
          </div>
          <CardDescription>Za lekce, kurzy, webináře a pravidelnou aktivitu.</CardDescription>
        </CardHeader>
        <CardContent>
          <MedaileOdznaku odznaky={odznaky} />
        </CardContent>
      </Card>

      {/* Certifikáty o absolvování kurzu (Fáze 5C) — jen když nějaký je. */}
      {certifikaty.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Moje certifikáty</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y" aria-label="Certifikáty">
              {certifikaty.map((certifikat) => (
                <li
                  key={certifikat.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
                >
                  <Award className="text-primary size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{certifikat.courseTitle}</p>
                    <p className="text-muted-foreground text-xs">
                      <span className="font-mono">{certifikat.number}</span> ·{" "}
                      {formatDatum(certifikat.issuedAt)}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <a href={"/ucet/certifikat/" + certifikat.id} download>
                      <Download />
                      Stáhnout PDF
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
                <li key={produkt.productId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 font-medium break-words">{produkt.name}</span>
                    <span
                      className={
                        produkt.skoncilo ? "text-muted-foreground text-sm" : "text-sm font-medium"
                      }
                    >
                      {popisPlatnosti(produkt)}
                    </span>
                  </div>
                  {/* Odpočet jen posledních 30 dní (Jakub, 10. 10. 2026). */}
                  {produkt.zbyvaDni !== null && produkt.zbyvaDni <= ODPOCET_DNI && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-konec-clenstvi text-konec-clenstvi-foreground border-0">
                        {textOdpoctu(produkt.zbyvaDni)}
                      </Badge>
                      {/* Prodloužení přímo v klientské části (20. 10. 2026). */}
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/ucet/koupit?produkt=${produkt.productId}`}>Prodloužit</Link>
                      </Button>
                    </div>
                  )}
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
                    {platitOnline &&
                      (objednavka.status === "NOVA" || objednavka.status === "NEZAPLACENO") && (
                        <Zaplatit orderId={objednavka.id} cislo={objednavka.number} />
                      )}
                    {platitPrevodem &&
                      (objednavka.status === "NOVA" || objednavka.status === "NEZAPLACENO") && (
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/ucet/platba-prevodem?cislo=${encodeURIComponent(objednavka.number)}`}
                          >
                            Platba převodem
                          </Link>
                        </Button>
                      )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDatum(objednavka.createdAt)}
                    {objednavka.paidAt && ` · zaplaceno ${formatDatum(objednavka.paidAt)}`}
                    {objednavka.sleva &&
                      ` · slevový kód ${objednavka.sleva.kod} −${formatMoney(objednavka.sleva.castka, objednavka.currency)}`}
                  </p>
                  {objednavka.doklady.length > 0 && (
                    <p className="flex flex-wrap gap-x-3 text-xs">
                      {objednavka.doklady.map((doklad) => (
                        <a
                          key={doklad.id}
                          href={`/ucet/faktura/${doklad.id}`}
                          className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                        >
                          <Download className="size-3" aria-hidden />
                          {doklad.dobropis ? "Dobropis" : "Faktura"} {doklad.number}
                        </a>
                      ))}
                    </p>
                  )}
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

/** Kolik dní před koncem se u členství ukazuje odpočet. */
const ODPOCET_DNI = 30;

function textOdpoctu(dni: number): string {
  if (dni === 0) return "Končí dnes";
  if (dni === 1) return "Zbývá 1 den";
  if (dni < 5) return `Zbývají ${dni} dny`;
  return `Zbývá ${dni} dní`;
}

function tvarTydnu(pocet: number): string {
  if (pocet === 1) return "týden";
  if (pocet >= 2 && pocet <= 4) return "týdny";
  return "týdnů";
}

function textAktivity(serie: number, maVytrvalost: boolean): string {
  if (serie >= 4) return "Chodíte pravidelně, jen tak dál.";
  if (maVytrvalost) return "Přijďte i příští týden, ať série pokračuje.";
  const zbyva = 4 - serie;
  return zbyva === 1
    ? "Přijďte i příští týden a máte odznak Vytrvalost."
    : `Přijďte ještě ${zbyva} týdny po sobě a máte odznak Vytrvalost.`;
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
