import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, History, Search, Send, UserMinus, Users } from "lucide-react";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pocetNevyresenychChyb } from "@/lib/chyby";
import { formatDatumCas } from "@/lib/format";
import { nactiNastaveni } from "@/lib/nastaveni";
import { cisloParam, precti, textParam } from "@/lib/parametry";
import { requireAdmin } from "@/lib/session";
import {
  nactiOdeslane,
  nactiPosledniOdhlasene,
  nactiPrehledSynchronizace,
} from "@/lib/smartemailing-synchronizace";

import { HromadneOdeslani } from "./hromadne-odeslani";
import { NacistOdhlasene } from "./nacist-odhlasene";
import { SpatnyEmail } from "./spatny-email";

export const metadata: Metadata = { title: "SmartEmailing" };

export const dynamic = "force-dynamic";

const NA_STRANKU = 25;

/**
 * SmartEmailing → Synchronizace kontaktů (Jakub, 13. 9. 2026).
 *
 * **Vidí i používá jen administrátor.** Přehled, hromadné odeslání,
 * odhlášení a seznam odeslaných klientů. Chyby odeslání jsou od 15. 9. 2026
 * v záložce Chyby, tady je na ně jen odkaz. Hledaný výraz je v adrese, ale
 * do Aktivity jde adresa bez části za otazníkem.
 */
export default async function SynchronizacePage({ searchParams }: PageProps<"/smartemailing">) {
  await requireAdmin();

  const vstup = precti(
    z.object({
      hledat: textParam(100),
      strana: cisloParam({ min: 1, max: 10_000, vychozi: 1 }),
    }),
    await searchParams,
  );
  const hledat = vstup.hledat ?? "";
  const strana = vstup.strana;

  const [nastaveni, prehled, pocetChyb, odhlaseni, odeslani] = await Promise.all([
    nactiNastaveni(),
    nactiPrehledSynchronizace(),
    pocetNevyresenychChyb("smartemailing"),
    nactiPosledniOdhlasene(),
    nactiOdeslane({ hledat, strana, naStranku: NA_STRANKU }),
  ]);

  const zapnuto = nastaveni.smartemailingEnabled && nastaveni.smartemailingListId !== null;
  const stranek = Math.max(1, Math.ceil(odeslani.pocet / NA_STRANKU));

  const odkazNaStranu = (cislo: number) => {
    const dotaz = new URLSearchParams();
    if (hledat) dotaz.set("hledat", hledat);
    if (cislo > 1) dotaz.set("strana", String(cislo));
    const text = dotaz.toString();
    return text ? `/smartemailing?${text}` : "/smartemailing";
  };

  return (
    <>
      {!zapnuto && (
        <Alert variant="destructive">
          <AlertTitle>Propojení je vypnuté</AlertTitle>
          <AlertDescription>
            Noví klienti do SmartEmailingu neodcházejí a hromadné odeslání nejde spustit. Zapni ho v{" "}
            <Link href="/smartemailing/nastaveni" className="underline">
              Nastavení propojení
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Dlazdice
          nazev="Odesláno"
          hodnota={prehled.odeslano}
          popis="klientů je ve SmartEmailingu"
        />
        <Dlazdice
          nazev="Čeká na odeslání"
          hodnota={prehled.cekajici}
          popis="se souhlasem, ještě neodešli"
        />
        <Dlazdice
          nazev="Chyby"
          hodnota={prehled.chyby}
          popis="odeslání se nepovedlo"
          zvyraznit={prehled.chyby > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Hromadné odeslání
          </CardTitle>
          <CardDescription>
            Pošle klienty se souhlasem s marketingem a e-mailem, kteří do SmartEmailingu ještě
            neodešli — typicky ty, kteří byli v CRM dřív než propojení. Včetně leadů z webu. Odesílá
            se postupně na pozadí, výsledek každého klienta se objeví níž.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HromadneOdeslani
            pocet={prehled.cekajici}
            nahled={prehled.nahledCekajicich}
            nazevSeznamu={nastaveni.smartemailingListName}
            zapnuto={zapnuto}
            bezi={prehled.hromadneBezi}
            zbyva={prehled.hromadneZbyva}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Chyby odeslání
            {pocetChyb > 0 ? (
              <Badge variant="destructive">{pocetChyb}</Badge>
            ) : (
              <Badge variant="secondary">Žádné</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Selhání SmartEmailingu (odeslání klienta i odhlášení) jsou v záložce Chyby spolu s
            chybami e-mailů a příjmu leadů. Tam je jde znovu spustit, nebo uzavřít. Kdo klienta
            založil, vidí selhání i na jeho kartě.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/smartemailing/chyby?druh=smartemailing">Otevřít chyby SmartEmailingu</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserMinus className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Odhlášení ze SmartEmailingu
          </CardTitle>
          <CardDescription>
            Načte ze SmartEmailingu, kdo se z vybraného seznamu odhlásil nebo je zablokovaný, a těm
            klientům v CRM odebere souhlas s marketingem. Každé odebrání se zapíše do auditu. Kdo má
            jen nedoručitelný e-mail, souhlas si nechá a objeví se v seznamu Špatný e-mail. Kontakty
            změněné ve SmartEmailingu v posledních 10 minutách se vezmou až při dalším načtení.
            Automaticky, hned po odhlášení, to dělá příjem odhlášení v{" "}
            <Link href="/smartemailing/nastaveni" className="underline">
              Nastavení propojení
            </Link>{" "}
            — funguje jen na veřejné adrese s https.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NacistOdhlasene seznamVybrany={nastaveni.smartemailingListId !== null} />

          <SpatnyEmail />

          {odhlaseni.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Souhlas odebrán po odhlášení</h3>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Posledních 20 klientů, kterým CRM odebralo souhlas, protože se ve SmartEmailingu
                odhlásili. Je to záznam z auditu — zůstává, i když klient souhlas později znovu dá.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Klient</TableHead>
                    <TableHead>Souhlas odebrán</TableHead>
                    <TableHead>Odkud</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {odhlaseni.map((zaznam) => (
                    <TableRow key={zaznam.id}>
                      <TableCell>
                        {zaznam.smazany ? (
                          <>
                            <span className="font-medium">{zaznam.name}</span>
                            <div className="text-muted-foreground text-xs">smazaný klient</div>
                          </>
                        ) : (
                          <OdkazNaKlienta
                            id={zaznam.clientId}
                            jmeno={zaznam.name}
                            email={zaznam.email}
                          />
                        )}
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap">
                        {formatDatumCas(zaznam.at)}
                      </TableCell>
                      <TableCell>{zaznam.kdo}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Odeslaní klienti
            <Badge variant="secondary">{odeslani.pocet}</Badge>
          </CardTitle>
          <CardDescription>
            Klienti, kteří do SmartEmailingu odešli, nejnovější první. Souhlas ukazuje stav v CRM
            teď — odebraný souhlas se do SmartEmailingu sám nepropíše.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action="/smartemailing" className="flex flex-wrap gap-2">
            <Input
              type="search"
              name="hledat"
              defaultValue={hledat}
              maxLength={100}
              placeholder="Jméno nebo e-mail"
              aria-label="Hledat odeslané klienty"
              className="w-full sm:w-72"
            />
            <Button type="submit" variant="outline">
              <Search />
              Hledat
            </Button>
          </form>

          {odeslani.klienti.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {hledat ? "Nikdo takový mezi odeslanými není." : "Zatím neodešel žádný klient."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Klient</TableHead>
                  <TableHead>Odesláno</TableHead>
                  <TableHead>Seznam</TableHead>
                  <TableHead>Souhlas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {odeslani.klienti.map((klient) => (
                  <TableRow key={klient.clientId}>
                    <TableCell>
                      <OdkazNaKlienta
                        id={klient.clientId}
                        jmeno={klient.name}
                        email={klient.email}
                      />
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      {klient.at ? formatDatumCas(klient.at) : "—"}
                    </TableCell>
                    <TableCell className="min-w-32 whitespace-normal">
                      {klient.seznam ?? "—"}
                    </TableCell>
                    <TableCell>
                      {klient.souhlas ? (
                        <Badge variant="secondary">Udělen</Badge>
                      ) : (
                        <Badge variant="outline">Odebrán</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {stranek > 1 && (
            <nav aria-label="Stránkování" className="flex items-center justify-between text-sm">
              {strana > 1 ? (
                <Link href={odkazNaStranu(strana - 1)} className="hover:underline">
                  ← Novější
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Strana {strana} z {stranek}
              </span>
              {strana < stranek ? (
                <Link href={odkazNaStranu(strana + 1)} className="hover:underline">
                  Starší →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <History className="size-3.5" aria-hidden />
        Každé odeslání i odebrání souhlasu je v Nastavení → Aktivita.
      </p>
    </>
  );
}

function Dlazdice({
  nazev,
  hodnota,
  popis,
  zvyraznit = false,
}: {
  nazev: string;
  hodnota: number;
  popis: string;
  zvyraznit?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-muted-foreground text-sm">{nazev}</p>
        <p className={`tabular text-3xl font-semibold ${zvyraznit ? "text-destructive" : ""}`}>
          {hodnota}
        </p>
        <p className="text-muted-foreground text-xs">{popis}</p>
      </CardContent>
    </Card>
  );
}

function OdkazNaKlienta({ id, jmeno, email }: { id: string; jmeno: string; email: string | null }) {
  return (
    <>
      <Link href={`/klienti/${id}`} className="font-medium hover:underline">
        {jmeno}
      </Link>
      <div className="text-muted-foreground text-xs">{email ?? "—"}</div>
    </>
  );
}
