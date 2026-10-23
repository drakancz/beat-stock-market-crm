import type { Metadata } from "next";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarX2,
  Download,
  Filter,
  ReceiptText,
  Info,
  Megaphone,
  Minus,
  Repeat,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { nactiPlneniCilu } from "@/lib/cile";
import { LHUTA_DNU, miraProdlouzeni, nactiCislaClenstvi } from "@/lib/clenstvi";
import { formatDate, formatPrice } from "@/lib/format";
import { dnesniVolno } from "@/lib/nastaveni";
import { krokProObdobi, prectiObdobi } from "@/lib/obdobi";
import { nactiDashboard, nactiKlientyProVyber, nactiMojeUkoly } from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { nactiTrychtyr, podil } from "@/lib/trychtyr";

import { GrafHodnoty, GrafKategorii } from "./grafy-odlozene";
import { nactiMozneMajitele } from "../klienti/ukoly-actions";
import { MujDen } from "./muj-den";
import { Pipeline } from "./pipeline";
import { VyberObdobi } from "./vyber-obdobi";
import { MENA_CENIKU } from "../produkty/nabidka";

export const metadata: Metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

/** Jak se popisuje délka kroku v grafu vývoje. */
const KROK_POPIS = {
  den: "po dnech",
  tyden: "po týdnech",
  mesic: "po měsících",
} as const;

/**
 * Srovnání se stejně dlouhým úsekem těsně před obdobím.
 *
 * Zisková zelená a ztrátová červená se tu schválně nepoužívají — jsou
 * vyhrazené výsledku portfolia (`src/app/globals.css`). Směr říká šipka
 * a text, ne barva.
 */
function zmena(ted: number, drive: number) {
  if (drive === 0) {
    if (ted === 0) return { text: "stejně jako předtím", smer: "stejne" as const };
    return { text: "předtím nic", smer: "nahoru" as const };
  }

  const procenta = ((ted - drive) / drive) * 100;
  if (Math.abs(procenta) < 0.5) return { text: "stejně jako předtím", smer: "stejne" as const };

  const znak = procenta > 0 ? "+" : "−";
  return {
    text: `${znak}${Math.round(Math.abs(procenta))} % proti předchozímu období`,
    smer: procenta > 0 ? ("nahoru" as const) : ("dolu" as const),
  };
}

/** Adresa exportu se stejným obdobím, jaké je zrovna na obrazovce. */
function odkazNaExport(parametry: Record<string, string | string[] | undefined>): string {
  const dotaz = new URLSearchParams();

  // Jen parametry období — nic dalšího export nečte.
  for (const klic of ["obdobi", "od", "do"]) {
    const hodnota = parametry[klic];
    const text = Array.isArray(hodnota) ? hodnota[0] : hodnota;
    if (text) dotaz.set(klic, text);
  }

  const retezec = dotaz.toString();
  return retezec ? `/dashboard/export?${retezec}` : "/dashboard/export";
}

/**
 * Nadpis karty s ikonou.
 *
 * Ikona je orientační bod, ne informace — každá karta má vedle ní i název,
 * takže se obrazovka dá číst i bez obrázků.
 */
function Nadpis({ ikona: Ikona, children }: { ikona: LucideIcon; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Ikona className="text-muted-foreground size-4 shrink-0" aria-hidden />
      {children}
    </CardTitle>
  );
}

/** Jedno číslo v oddílu Členství: popisek, hodnota, vysvětlivka. */
function UdajClenstvi({
  titulek,
  hodnota,
  pod,
}: {
  titulek: string;
  hodnota: string;
  pod: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-muted-foreground text-sm">{titulek}</dt>
      <dd className="tabular text-2xl leading-tight font-semibold">{hodnota}</dd>
      <dd className="text-muted-foreground text-xs">{pod}</dd>
    </div>
  );
}

function Dlazdice({
  titulek,
  hodnota,
  pod,
  ted,
  drive,
}: {
  titulek: string;
  hodnota: string;
  pod?: string;
  ted: number;
  drive: number;
}) {
  const trend = zmena(ted, drive);
  const Sipka =
    trend.smer === "nahoru" ? ArrowUpRight : trend.smer === "dolu" ? ArrowDownRight : Minus;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{titulek}</CardDescription>
        <CardTitle className="tabular text-3xl leading-tight font-semibold">{hodnota}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {pod && <p className="text-muted-foreground tabular text-sm">{pod}</p>}
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Sipka className="size-3.5 shrink-0" aria-hidden />
          {trend.text}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard — čísla za zvolené období.
 *
 * **Vidí ho každý přihlášený** a od 22. 9. 2026 všichni stejná čísla —
 * klienti se nikomu nepřiřazují.
 * Omezení je v dotazu (`nactiDashboard()` v `src/lib/queries.ts`), ne ve
 * výpisu — kdo si adresu vyťuká sám, dostane přesně totéž.
 *
 * Měnit se tu nedá nic; obrazovka jen čte. Nepřihlášený se sem nedostane,
 * o to se stará `requireViewer()` a rám celého CRM.
 *
 * Nahradila dřívější obrazovku Statistiky, která ukazovala táž čísla bez
 * možnosti vybrat období.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const viewer = await requireViewer();

  const parametry = await searchParams;
  const obdobi = prectiObdobi(parametry);

  const [data, cile, ukoly, volno, klienti, majitele, trychtyr, clenstvi] = await Promise.all([
    nactiDashboard(viewer, obdobi),
    nactiPlneniCilu(viewer),
    nactiMojeUkoly(viewer),
    dnesniVolno(),
    // Pro okno Nový úkol v Mém dni (od 23. 9. 2026).
    nactiKlientyProVyber(viewer),
    nactiMozneMajitele(),
    nactiTrychtyr(viewer, obdobi),
    nactiCislaClenstvi(viewer, obdobi),
  ]);

  const krok = krokProObdobi(obdobi.dnu);
  const prazdno = data.soucasnost.objednavky === 0;

  return (
    <>
      <div>
        {/* Oslovení z Mého profilu. */}
        <p className="mb-1 text-lg font-medium">
          Vítej, {viewer.osloveni}!{" "}
          <span
            className="motion-safe:animate-mavani inline-block origin-[70%_70%]"
            role="img"
            aria-label="mávající ruka"
          >
            👋
          </span>
        </p>
        <h2 className="text-2xl font-semibold">Dashboard</h2>
      </div>

      {/*
        Co mě dnes čeká. Stojí nad volbou období schválně — viz komentář
        v `muj-den.tsx`. Od 22. 9. 2026, kdy se zrušila obrazovka Dnešek.
      */}
      <MujDen ukoly={ukoly} volno={volno} klienti={klienti} majitele={majitele} />

      {/*
        Odtud níž se všechno řídí zvoleným obdobím. Nadpis a popisek jsou
        tady, ne nahoře u pozdravu, aby bylo vidět, čeho přesně se přepínač
        týká — blok „Můj den" nad ním se nemění.
      */}
      <div className="border-border flex flex-wrap items-start justify-between gap-3 border-t pt-6">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Čísla za {obdobi.label}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatDate(obdobi.prvniDen)} až {formatDate(obdobi.posledniDen)}.
          </p>
        </div>
        {/*
          Export statistik (Jakub, 23. 9. 2026) — smí každý přihlášený,
          jen součty, žádná jména. Obyčejný odkaz, ne serverová akce:
          prohlížeč má soubor stáhnout. Nese stejné období jako obrazovka,
          takže soubor ukáže přesně tahle čísla.
        */}
        <Button asChild variant="outline" size="sm">
          <a href={odkazNaExport(parametry)}>
            <Download />
            Stáhnout do tabulky
          </a>
        </Button>
      </div>

      <VyberObdobi obdobi={obdobi} />

      {obdobi.odmitnutyRozsah && (
        <Alert variant="destructive">
          <CalendarX2 />
          <AlertTitle>Zadaný rozsah nešel použít</AlertTitle>
          <AlertDescription>
            Datum v adrese neexistuje v kalendáři, je obrácené, nebo je delší než pět let. Ukazuje
            se místo něj výchozích 30 dní — čísla níž tedy nejsou za zadané období.
          </AlertDescription>
        </Alert>
      )}

      {/*
        Dlaždice byly do 22. 9. 2026 čtyři — čtvrtá počítala brokery na
        případech z období. Zrušila se spolu s grafem téhož jména: broker
        se u objednávky nevede vůbec.

        Třetí dlaždice (Hovory) zmizela 20. 10. 2026 spolu s hovory v CRM.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Dlazdice
          titulek="Objednávky"
          hodnota={String(data.soucasnost.objednavky)}
          pod={`přijaté v období`}
          ted={data.soucasnost.objednavky}
          drive={data.minulost.objednavky}
        />
        <Dlazdice
          titulek="Cena objednávek"
          hodnota={formatPrice(data.soucasnost.hodnota, MENA_CENIKU)}
          pod="bez DPH, objednávky přijaté v období"
          ted={data.soucasnost.hodnota}
          drive={data.minulost.hodnota}
        />
      </div>

      {/*
        Plnění cíle je vždycky za tento měsíc, ne za zvolené období —
        cíle se nastavují po měsících. Od 22. 9. 2026 je cíl jeden, za
        celou firmu: klienti se nikomu nepřiřazují, takže tržby nejde
        rozdělit po lidech.
      */}
      <Card>
        <CardHeader>
          <Nadpis ikona={Target}>Plnění cíle — {cile.popis}</Nadpis>
          <CardDescription>
            Tržby ze zaplacených objednávek za tento měsíc, bez DPH. Cíl nastavuje administrátor v
            Nastavení → Cíle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cile.radky.length === 0 ? (
            <p className="text-muted-foreground text-sm">Cíl zatím nikdo nenastavil.</p>
          ) : (
            <ul className="space-y-4">
              {cile.radky.map((radek) => {
                const procenta = radek.cil > 0 ? Math.round((radek.trzby / radek.cil) * 100) : 0;

                return (
                  <li key={radek.id ?? "tym"} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                      <span className="font-medium">{radek.name}</span>
                      <span className="text-muted-foreground tabular">
                        {formatPrice(radek.trzby, MENA_CENIKU)}
                        {radek.cil > 0
                          ? ` z ${formatPrice(radek.cil, MENA_CENIKU)} · ${procenta} %`
                          : " · bez cíle"}
                      </span>
                    </div>
                    {radek.cil > 0 && (
                      <div
                        className="bg-muted h-2 overflow-hidden rounded-full"
                        role="progressbar"
                        aria-label={`Plnění cíle: ${radek.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(procenta, 100)}
                      >
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${Math.min(procenta, 100)}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {prazdno && (
        <Alert>
          <Info />
          <AlertTitle>Za tohle období tu nic není</AlertTitle>
          <AlertDescription>
            Ve vybraném rozsahu nepřišla žádná objednávka. Zkus delší období — grafy níž zůstávají
            prázdné, ne rozbité.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <Nadpis ikona={TrendingUp}>Cena nových objednávek v čase</Nadpis>
          <CardDescription>
            Součet cen objednaných produktů bez DPH, sečteno {KROK_POPIS[krok]} podle dne, kdy
            objednávka přišla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GrafHodnoty data={data.vyvoj} mena={MENA_CENIKU} />
        </CardContent>
      </Card>

      {/*
        Pipeline stojí přes celou šířku, ne v mřížce vedle dalšího grafu —
        na polovině obrazovky se popisky lámaly. Od 22. 9. 2026, kdy vedle
        ní přestali stát „Klienti podle stavu".
      */}
      <Card>
        <CardHeader>
          <Nadpis ikona={ReceiptText}>Objednávky podle stavu</Nadpis>
          <CardDescription>
            Kolik objednávek z období je v kterém stavu a za kolik, bez DPH.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Pipeline
            stupne={data.objednavkyPodleStavu}
            mena={MENA_CENIKU}
            tvary={["objednávka", "objednávky", "objednávek"]}
          />
        </CardContent>
      </Card>

      {/*
        Konverzní trychtýř (Jakub, 27. 9. 2026, krok 2B). Vidí každý
        přihlášený. Procenta jsou z nových klientů, ne z předchozího
        stupně — u objednávek se „z předchozího" neosvědčilo (viz Pipeline).
      */}
      <Card>
        <CardHeader>
          <Nadpis ikona={Filter}>Konverzní trychtýř</Nadpis>
          <CardDescription>
            Klienti, kteří přibyli v období, a kolik z nich už objednalo a zaplatilo — i po konci
            období. Procenta jsou z nových klientů.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {trychtyr.noviKlienti === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              V období nepřibyl žádný klient.
            </p>
          ) : (
            <>
              <Pipeline
                stupne={[
                  { label: "Noví klienti", pocet: trychtyr.noviKlienti },
                  {
                    label: `Objednali · ${podil(trychtyr.objednali, trychtyr.noviKlienti)} %`,
                    pocet: trychtyr.objednali,
                  },
                  {
                    label: `Zaplatili · ${podil(trychtyr.zaplatili, trychtyr.noviKlienti)} %`,
                    pocet: trychtyr.zaplatili,
                  },
                ]}
                tvary={["klient", "klienti", "klientů"]}
              />
              <div className="-mx-2 overflow-x-auto px-2">
                <Table aria-label="Trychtýř podle zdroje">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zdroj</TableHead>
                      <TableHead className="text-right">Noví</TableHead>
                      <TableHead className="text-right">Objednali</TableHead>
                      <TableHead className="text-right">Zaplatili</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trychtyr.podleZdroje.map((radek) => (
                      <TableRow key={radek.zdroj}>
                        <TableCell className="font-medium">{radek.zdroj}</TableCell>
                        <TableCell className="tabular text-right">{radek.noviKlienti}</TableCell>
                        <TableCell className="tabular text-right">
                          {radek.objednali}{" "}
                          <span className="text-muted-foreground text-xs">
                            ({podil(radek.objednali, radek.noviKlienti)} %)
                          </span>
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {radek.zaplatili}{" "}
                          <span className="text-muted-foreground text-xs">
                            ({podil(radek.zaplatili, radek.noviKlienti)} %)
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/*
        Čísla členství (Jakub, 10. 10. 2026). Vidí každý přihlášený.
        Aktivní členové a měsíční příjem jsou k dnešku, ostatní za období.
      */}
      <Card>
        <CardHeader>
          <Nadpis ikona={Repeat}>Členství</Nadpis>
          <CardDescription>
            Aktivní členové a měsíční příjem k dnešku, prodloužení a noví členové za období.
            Prodloužení = další platba nejpozději {LHUTA_DNU} dní po konci. Částky bez DPH.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl
            className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Čísla členství"
          >
            <UdajClenstvi
              titulek="Aktivní členové"
              hodnota={String(clenstvi.aktivniClenove)}
              pod="dnes s platným členstvím"
            />
            <UdajClenstvi
              titulek="Měsíční příjem z členství"
              hodnota={formatPrice(clenstvi.mesicniPrijem, MENA_CENIKU)}
              pod="cena běžících členství přepočtená na měsíc"
            />
            <UdajClenstvi
              titulek="Míra prodloužení"
              hodnota={miraProdlouzeni(clenstvi) === null ? "—" : `${miraProdlouzeni(clenstvi)} %`}
              pod={
                clenstvi.prodlouzilo + clenstvi.odeslo === 0
                  ? "v období žádné členství neskončilo"
                  : `prodloužilo ${clenstvi.prodlouzilo} z ${clenstvi.prodlouzilo + clenstvi.odeslo}`
              }
            />
            <UdajClenstvi
              titulek="Odešli"
              hodnota={String(clenstvi.odeslo)}
              pod={
                clenstvi.cekaNaRozhodnuti > 0
                  ? `čeká na rozhodnutí: ${clenstvi.cekaNaRozhodnuti}`
                  : "členství skončilo a neprodloužili"
              }
            />
            <UdajClenstvi
              titulek="Noví členové"
              hodnota={String(clenstvi.noviClenove)}
              pod="poprvé koupili členství v období"
            />
            <UdajClenstvi
              titulek="Průměrná útrata klienta"
              hodnota={formatPrice(clenstvi.prumernaUtrata, MENA_CENIKU)}
              pod={`za celou dobu, z ${clenstvi.platicichKlientu} platících klientů`}
            />
          </dl>
        </CardContent>
      </Card>

      {/*
        Hovory podle výsledku zmizely 20. 10. 2026 spolu s hovory v CRM;
        Noví klienti podle zdroje zůstali sami, proto bez mřížky.

        Co odsud zmizelo (Jakub, 22. 9. 2026): „Hovory v čase" a „Brokeři
        na případech" a „Obchodníci" 22. 9. dopoledne, „Klienti podle
        stavu" odpoledne — ta druhá pipeline se pletla s tou nad sebou
        a stav klienta je vidět na jeho kartě (filtr stavů v seznamu zanikl 23. 9.).
      */}
      <Card>
        <CardHeader>
          <Nadpis ikona={Megaphone}>Noví klienti podle zdroje</Nadpis>
          <CardDescription>
            Odkud se o nás dozvěděli klienti založení v období. Seznam zdrojů spravuje administrátor
            v Nastavení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.podleZdroje.length > 0 ? (
            <GrafKategorii data={data.podleZdroje} popisPoctu="klientů" odstineni="velikost" />
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              V období nepřibyl žádný klient.
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        Poznámka pod čarou (vzor pro `PoznamkaPodCarou`, 23. 9. 2026). Dřív tu byl `PhaseNotice` s nadpisem „Zatím
        jen kostra", což na hotovém Dashboardu neplatí — text sám ale platí
        dál a je užitečný, hlavně to o cenách bez DPH.
      */}
      <p className="text-muted-foreground text-xs leading-relaxed">
        Čísla se počítají z databáze a zahrnují jen to, co smíš vidět. Všechny částky jsou v
        korunách <strong>bez DPH</strong> podle ceníku.
      </p>
    </>
  );
}
