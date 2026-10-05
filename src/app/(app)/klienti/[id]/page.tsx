import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CircleAlert,
  CopyCheck,
  Download,
  Mail,
  MessageSquare,
  NotebookPen,
  ReceiptText,
} from "lucide-react";

import { PopisChyby } from "@/components/popis-chyby";
import { SeznamOdznaku } from "@/components/vzdelavani/odznaky";
import { PrilohyDialog } from "@/components/soubory/prilohy-dialog";
import { SekcePriloh } from "@/components/soubory/sekce-priloh";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { POPIS_DUVODU, najdiDuplicity } from "@/lib/duplicity";
import { requireViewer } from "@/lib/session";
import { formatDatum, formatDatumCas, formatMoney, formatTelefon } from "@/lib/format";
import {
  nactiBrokery,
  nactiKlienta,
  nactiObjednavky,
  nactiPlatnostiKlienta,
  nactiPoznamkyKlienta,
  nactiProduktySPlatnosti,
  nactiZdrojeKlientu,
} from "@/lib/queries";
import { nactiNastaveni } from "@/lib/nastaveni";
import { jakoDen } from "@/lib/obdobi";
import { idZAdresy } from "@/lib/parametry";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  cekaNaOdeslani,
  type ChybaSmartemailingu,
} from "@/lib/smartemailing";
import { ORDER_STATUS_LABEL } from "@/lib/types";
import { stavUctu } from "@/lib/klient/pozvanka";
import { pocet } from "@/lib/mnozne";
import { nactiVzdelavaniKlienta } from "@/lib/vzdelavani/klient";

import { KlientDialog } from "../klient-dialog";
import { SmazaniKlienta } from "../smazani-klienta";

import { HlidaniSmartemailingu } from "./hlidani-smartemailingu";
import { KlientskaCast } from "./klientska-cast";
import { OknoKarty } from "./okno-karty";
import { PoslatDoSmartemailingu } from "./poslat-do-smartemailingu";
import { PoznamkyKlienta } from "./poznamky-klienta";
import { UpravaPlatnosti } from "./uprava-platnosti";
import { ZpravyKlienta } from "./zpravy-klienta";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/klienti/[id]">): Promise<Metadata> {
  const viewer = await requireViewer();
  const id = idZAdresy((await params).id);
  const klient = id ? await nactiKlienta(viewer, id) : null;
  return { title: klient?.name ?? "Klient" };
}

/**
 * Karta klienta.
 *
 * **Vidí ji každý přihlášený** (klienti se od 22. 9. 2026 nikomu
 * nepřiřazují). Omezení je v dotazu (`nactiKlienta()`), ne ve výpisu.
 *
 * **Podoba od 23. 9. 2026 (Jakub):** nahoře jméno s e-mailem a telefonem,
 * tlačítka Poslat email · Objednávky · Přílohy · Upravit · Smazat ·
 * Poznámky, pod tím Údaje. Záložky Časová osa, Hovory, Portfolia,
 * Objednávky a Úkoly zmizely; stav klienta se na kartě neukazuje (zůstal
 * ve formuláři Upravit). Hovory se zapisují v sekci Hovory, úkoly na
 * Dashboardu v Mém dni. Z databáze se tím nic nemazalo.
 */
export default async function KlientPage({ params }: PageProps<"/klienti/[id]">) {
  const viewer = await requireViewer();
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  // Podmínka viditelnosti je v dotazu — klient mimo rozsah role se prostě
  // nenajde, i kdyby někdo znal jeho adresu.
  const klient = await nactiKlienta(viewer, id);
  if (!klient) notFound();

  const jeAdmin = viewer.role === "ADMINISTRATOR";

  const [
    vsichniBrokeri,
    objednavky,
    poznamky,
    zdroje,
    nastaveni,
    pocetPriloh,
    platnosti,
    produktySPlatnosti,
    duplicity,
    ucet,
    zpravy,
  ] = await Promise.all([
    nactiBrokery(),
    // Rozsah role hlídá `nactiObjednavky()` znovu — na cizí objednávku
    // se přes adresu klienta nedá dostat.
    nactiObjednavky(viewer, { klientId: klient.id }),
    nactiPoznamkyKlienta(viewer, klient.id),
    nactiZdrojeKlientu(),
    nactiNastaveni(),
    // Jen počet na tlačítko Přílohy; samotné soubory načítá `SekcePriloh`,
    // která si znovu ověří, kdo je smí vidět.
    db.attachment.count({
      where: { ownerType: "KLIENT", ownerId: klient.id, deletedAt: null },
    }),
    nactiPlatnostiKlienta(viewer, klient.id),
    // Výběr produktu v okně Upravit platnost — to má jen administrátor.
    jeAdmin ? nactiProduktySPlatnosti() : Promise.resolve([]),
    najdiDuplicity(klient.id),
    // Účet do klientské části (krok 3A) — stav vidí každý, kdo vidí kartu.
    db.clientAccount.findUnique({
      where: { clientId: klient.id },
      select: {
        passwordHash: true,
        revokedAt: true,
        invitedAt: true,
        lastLoginAt: true,
        notificationsEnabled: true,
      },
    }),
    // Zprávy od administrátora (3A, 4. 10. 2026) — historii vidí každý,
    // kdo vidí kartu; psát smí jen administrátor.
    db.clientMessage.findMany({
      where: { clientId: klient.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        text: true,
        delivery: true,
        createdAt: true,
        readAt: true,
        author: { select: { name: true } },
      },
    }),
  ]);

  const stavKlientskeCasti = stavUctu(ucet);
  const vzdelavani = await nactiVzdelavaniKlienta(klient.id);

  // Čerstvě založený klient se souhlasem: odeslání do SmartEmailingu ještě
  // běží, karta se proto sama obnoví, až bude výsledek (Jakub, 15. 9. 2026).
  const hlidatSmartemailing = cekaNaOdeslani(klient, nastaveni);

  // Ve formuláři Upravit se nabízejí jen brokeři, ke kterým klient ještě
  // přiřazený není — dvojice klient + broker smí existovat jen jednou.
  const maBrokery = new Set(klient.brokerIds);
  const volniBrokeri = vsichniBrokeri
    .filter((broker) => !maBrokery.has(broker.id))
    .map((broker) => ({ id: broker.id, name: broker.name }));

  // `nactiObjednavky()` řadí od nejnovější, první je tedy poslední objednávka.
  const posledniObjednavka = objednavky[0]?.createdAt ?? null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/klienti">
          <ArrowLeft />
          Zpět na klienty
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">{klient.name}</h2>
          {/* Kontakt je jen jeden, nebo oba — tečka mezi nimi se ukáže
              jen tehdy, když je co oddělovat. */}
          <p className="text-muted-foreground mt-1.5 text-sm">
            {[klient.email, klient.phone && formatTelefon(klient.phone)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
           * Posílání e-mailů zatím nikam nevede — přijde ve fázi 2. Do té
           * doby je tlačítko znecitlivěné, aby nevypadalo jako hotová
           * funkce. Do 23. 9. 2026 se jmenovalo Napsat.
           */}
          <Button variant="outline" disabled title="Posílání e-mailů z karty přijde ve fázi 2.">
            <Mail />
            Poslat email
          </Button>

          {/* Objednávky klienta v okně (Jakub, 23. 9. 2026) — nahradily
              tlačítko Zapsat hovor i záložku Objednávky. Jen čtení; stav
              mění administrátor v sekci Objednávky, přístup do programu
              v seznamu klientů. */}
          <OknoKarty
            tlacitko={`Objednávky (${objednavky.length})`}
            ikona={<ReceiptText />}
            nadpis="Objednávky"
            popis={`Objednávky klienta ${klient.name} z Landing Page. Ceny jsou bez DPH.`}
          >
            <SeznamObjednavek objednavky={objednavky} klientId={klient.id} />
          </OknoKarty>

          {/* Přílohy klienta (Jakub, 21. 9. 2026). Kdo je smí vidět
              a nahrávat, rozhoduje `SekcePriloh` na serveru. */}
          <PrilohyDialog
            pocet={pocetPriloh}
            popis={`Soubory u klienta ${klient.name}. U každého je vidět, kdo ho nahrál. Smazat soubor smí ten, kdo ho vložil, a správce.`}
          >
            <SekcePriloh typ="KLIENT" id={klient.id} bezRamu />
          </PrilohyDialog>

          <KlientDialog
            brokeri={volniBrokeri}
            brokeriKlienta={klient.brokeri}
            zdroje={zdroje}
            klient={{
              id: klient.id,
              name: klient.name,
              email: klient.email ?? "",
              phone: klient.phone ?? "",
              sourceId: klient.sourceId,
              stage: klient.stage,
              souhlasMarketing: klient.consentMarketingAt !== null,
              souhlasNahravani: klient.consentRecordingAt !== null,
            }}
          />

          {/* Mazat klienty smí jen administrátor — kontroluje to serverová akce. */}
          {viewer.role === "ADMINISTRATOR" && (
            <SmazaniKlienta klient={{ id: klient.id, name: klient.name }} />
          )}

          {/* Poznámky (Jakub, 23. 9. 2026): píše každý přihlášený, opravit
              a smazat smí autor a administrátor. Klient je nevidí. */}
          <OknoKarty
            tlacitko={`Poznámky (${poznamky.length})`}
            ikona={<NotebookPen />}
            nadpis="Poznámky"
            popis={`Zápisník týmu u klienta ${klient.name}. U každé poznámky je vidět, kdo ji napsal a kdy.`}
          >
            <PoznamkyKlienta
              klientId={klient.id}
              poznamky={poznamky}
              viewerId={viewer.id}
              jeAdmin={viewer.role === "ADMINISTRATOR"}
            />
          </OknoKarty>

          {/* Zprávy do klientské části (3A, Jakub 4. 10. 2026): historii
              vidí každý, psát smí administrátor u klienta s aktivním účtem. */}
          {(stavKlientskeCasti === "aktivni" || zpravy.length > 0) && (
            <OknoKarty
              tlacitko={`Zprávy (${zpravy.length})`}
              ikona={<MessageSquare />}
              nadpis="Zprávy klientovi"
              popis={`Zprávy do klientské části: ${klient.name}. Psát smí administrátor.`}
            >
              <ZpravyKlienta
                klientId={klient.id}
                muzePsat={jeAdmin && stavKlientskeCasti === "aktivni"}
                upozorneniVypnuta={ucet?.notificationsEnabled === false}
                zpravy={zpravy.map((zprava) => ({
                  id: zprava.id,
                  text: zprava.text,
                  autor: zprava.author?.name ?? null,
                  kdy: formatDatumCas(zprava.createdAt),
                  doruceni: POPIS_DORUCENI_ZPRAVY[zprava.delivery] ?? "uloženo",
                  precteno: zprava.readAt ? formatDatumCas(zprava.readAt) : null,
                }))}
              />
            </OknoKarty>
          )}
        </div>
      </div>

      {hlidatSmartemailing && <HlidaniSmartemailingu />}

      {/*
       * Možná duplicita (Jakub, 27. 9. 2026, krok 2B). Vidí každý, kdo vidí
       * kartu; rozhoduje se na stránce Možné duplicity (sloučit smí
       * administrátor, „nejsou stejný člověk“ každý).
       */}
      {duplicity.length > 0 && (
        <Alert>
          <CopyCheck />
          <AlertTitle>Možná duplicita</AlertTitle>
          <AlertDescription>
            <ul className="space-y-0.5">
              {duplicity.map((dvojice) => {
                const druhy = dvojice.a.id === klient.id ? dvojice.b : dvojice.a;
                return (
                  <li key={druhy.id}>
                    <Link
                      href={`/klienti/${druhy.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {druhy.name}
                    </Link>{" "}
                    ({dvojice.duvody.map((duvod) => POPIS_DUVODU[duvod]).join(", ")})
                  </li>
                );
              })}
            </ul>
            <Link href="/klienti/duplicity" className="underline underline-offset-4">
              Rozhodnout v přehledu možných duplicit
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/*
       * Selhání odeslání do SmartEmailingu (Jakub, 15. 9. 2026). Vidí ho
       * každý, kdo vidí kartu — hlavně ten, kdo klienta právě založil.
       * Podrobný popis chyby a Odeslat znovu jsou jen pro administrátora.
       */}
      {klient.smartemailingError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Do SmartEmailingu klient neodešel</AlertTitle>
          <AlertDescription>
            <div className="flex items-start gap-1">
              <p>
                {POPIS_CHYBY_SMARTEMAILINGU[klient.smartemailingError as ChybaSmartemailingu] ??
                  "Neznámá chyba"}
                . V CRM je klient uložený v pořádku.{" "}
                {viewer.role === "ADMINISTRATOR" ? (
                  <>
                    Poslat ho znovu jde v sekci{" "}
                    <Link href="/smartemailing/chyby?druh=smartemailing" className="underline">
                      Chyby
                    </Link>
                    .
                  </>
                ) : (
                  "Administrátor ho může poslat znovu."
                )}
              </p>
              {/* Co přesně SmartEmailing odpověděl — jen administrátor
                  (Jakub, 15. 9. 2026). Text je bez e-mailových adres. */}
              {viewer.role === "ADMINISTRATOR" && (
                <PopisChyby
                  detail={klient.smartemailingErrorDetail}
                  popisek="Do SmartEmailingu klient neodešel"
                />
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/*
        Údaje (Jakub, 23. 9. 2026): jen základ — kontakt, objednávky
        a souhlas s marketingem. Souhlas s nahráváním, Zdroj, V systému od
        a Poslední kontakt zmizely. Řádky SmartEmailingu zůstaly, patří
        k souhlasu s marketingem.
      */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Údaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="E-mail" value={klient.email} />
          <Row label="Telefon" value={klient.phone ? formatTelefon(klient.phone) : "—"} />
          {/*
            Broker (Jakub, 25. 9. 2026): u koho má klient portfolio —
            přiřazuje se v okně Upravit → Brokeři. Vidí každý, kdo vidí kartu.
          */}
          <Row
            label="Broker"
            value={
              klient.brokeri.length > 0
                ? klient.brokeri.map((broker) => broker.nazev).join(", ")
                : "—"
            }
          />
          {/*
            Co klient sám uvedl při objednávce nebo na webu — jen informace,
            portfolio z toho nevzniká (Jakub, 25. 9. 2026). Řádek je jen
            u klienta, který o brokerech něco uvedl.
          */}
          {klient.brokersReportedAt && (
            <Row
              label="Broker podle klienta"
              value={`${
                klient.reportedBrokers.length > 0
                  ? klient.reportedBrokers.join(", ")
                  : "nemá brokera"
              } (uvedeno z webu ${formatDatum(klient.brokersReportedAt)})`}
            />
          )}
          <Separator />
          <Row label="Počet objednávek" value={String(objednavky.length)} />
          <Row
            label="Poslední objednávka"
            value={posledniObjednavka ? formatDatum(posledniObjednavka) : "—"}
          />
          {/*
            Platnost produktů (Jakub, 24. 9. 2026): vidí každý, kdo vidí
            kartu; upravit konec smí jen administrátor (hlídá to akce).
            Blok se ukáže, jen když je co ukázat nebo co upravit.
          */}
          {(platnosti.length > 0 || produktySPlatnosti.length > 0) && (
            <>
              <Separator />
              <section aria-label="Platnost" className="space-y-3">
                {platnosti.length === 0 ? (
                  <Row label="Platnost" value="Nic neběží" />
                ) : (
                  platnosti.map((platnost) => (
                    <div
                      key={platnost.productId}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-muted-foreground min-w-0 text-xs">
                        {platnost.produkt}
                      </span>
                      <span
                        className={
                          platnost.skoncilo
                            ? "text-muted-foreground shrink-0 text-right"
                            : "shrink-0 text-right font-medium"
                        }
                      >
                        {platnost.skoncilo
                          ? `skončilo ${formatDatum(platnost.do)}`
                          : `do ${formatDatum(platnost.do)}`}
                      </span>
                    </div>
                  ))
                )}
                {jeAdmin && (
                  <UpravaPlatnosti
                    klientId={klient.id}
                    jmeno={klient.name}
                    produkty={produktySPlatnosti}
                    konce={Object.fromEntries(
                      platnosti.map((platnost) => [platnost.productId, jakoDen(platnost.do)]),
                    )}
                  />
                )}
              </section>
            </>
          )}
          <Separator />
          {/* Souhlas se eviduje včetně data — bez něj se nesmí nic odeslat. */}
          <Row
            label="Souhlas s marketingem"
            value={
              klient.consentMarketingAt
                ? `Udělen ${formatDatum(klient.consentMarketingAt)}`
                : "Neudělen"
            }
          />
          {/* Jen u klienta, u kterého se o odeslání pokoušelo. Odhlášení po
              odebraném souhlasu má přednost (Jakub, 15. 9. 2026). */}
          {(klient.smartemailingSentAt ||
            klient.smartemailingError ||
            klient.smartemailingUnsubscribedAt) && (
            <Row
              label="SmartEmailing"
              value={
                klient.smartemailingUnsubscribedAt
                  ? `Odhlášen ze seznamu ${formatDatum(klient.smartemailingUnsubscribedAt)}`
                  : klient.smartemailingSentAt
                    ? `Odesláno ${formatDatum(klient.smartemailingSentAt)}`
                    : `Neodešlo — ${
                        POPIS_CHYBY_SMARTEMAILINGU[
                          klient.smartemailingError as ChybaSmartemailingu
                        ] ?? "neznámá chyba"
                      }`
              }
            />
          )}
          {/* Klient se ve SmartEmailingu sám odhlásil a CRM mu odebralo souhlas
              (Jakub, 15. 9. 2026). Vidí každý, kdo vidí kartu — tým tak ví,
              že mu marketing posílat nemá. */}
          {klient.smartemailingOptedOutAt && (
            <Row
              label="Odhlášení z odběru SmartEmailingu"
              value={formatDatum(klient.smartemailingOptedOutAt)}
            />
          )}
          {/* Poslat ručně smí jen administrátor — roli ověřuje i serverová akce. */}
          {viewer.role === "ADMINISTRATOR" &&
            klient.consentMarketingAt &&
            nastaveni.smartemailingEnabled &&
            nastaveni.smartemailingListId !== null && (
              <PoslatDoSmartemailingu clientId={klient.id} jmeno={klient.name} />
            )}
          <Separator />
          {/*
            Klientská část (krok 3A, Jakub 30. 9. 2026): stav vidí každý, kdo
            vidí kartu; pozvat a zrušit přístup smí jen administrátor.
          */}
          <Row label="Klientská část" value={popisKlientskeCasti(stavKlientskeCasti, ucet)} />
          {jeAdmin && (
            <KlientskaCast
              klient={{ id: klient.id, name: klient.name }}
              stav={stavKlientskeCasti}
            />
          )}
          {/*
            Vzdělávání (krok 3C, Jakub 4. 10. 2026): postup v kurzech, účast
            na webinářích a odznaky vidí každý, kdo vidí kartu.
          */}
          <Separator />
          <Row
            label="Kurzy"
            value={
              vzdelavani.kurzy.length > 0
                ? vzdelavani.kurzy
                    .map((kurz) => `${kurz.title} ${kurz.hotovo}/${kurz.lekci}`)
                    .join(", ")
                : "—"
            }
          />
          <Row
            label="Webináře"
            value={
              vzdelavani.webinaru > 0
                ? `účast ${pocet(vzdelavani.webinaru, "webinář", "webináře", "webinářů")}`
                : "—"
            }
          />
          {vzdelavani.odznaky.length > 0 ? (
            <div className="space-y-2">
              <span className="text-muted-foreground text-xs">Odznaky</span>
              <SeznamOdznaku odznaky={vzdelavani.odznaky} />
            </div>
          ) : (
            <Row label="Odznaky" value="—" />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Obsah okna Objednávky — do 23. 9. 2026 to byla záložka karty. */
function SeznamObjednavek({
  objednavky,
  klientId,
}: {
  objednavky: Awaited<ReturnType<typeof nactiObjednavky>>;
  klientId: string;
}) {
  return (
    <div className="space-y-4">
      {objednavky.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Zatím žádná. Objednávky zakládají klienti sami na Landing Page.
        </p>
      ) : (
        <ul className="divide-border divide-y" aria-label="Objednávky klienta">
          {objednavky.map((objednavka) => (
            <li
              key={objednavka.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0"
            >
              <span className="tabular min-w-0 flex-1 text-sm font-medium">
                {objednavka.number}
              </span>
              <Badge variant={objednavka.status === "ZAPLACENO" ? "default" : "outline"}>
                {ORDER_STATUS_LABEL[objednavka.status]}
              </Badge>
              <span className="tabular text-sm whitespace-nowrap">
                {formatMoney(objednavka.hodnota, objednavka.currency)}
              </span>
              <span className="text-muted-foreground w-full text-xs">
                {formatDatum(objednavka.createdAt)} ·{" "}
                {objednavka.produkty.length === 0
                  ? "Bez produktů"
                  : objednavka.produkty
                      .map((produkt) =>
                        produkt.quantity > 1
                          ? `${produkt.name} (${produkt.quantity}×)`
                          : produkt.name,
                      )
                      .join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
        {/* Sekce Objednávky umí filtr na jednoho klienta. */}
        <Link
          href={`/objednavky?klient=${encodeURIComponent(klientId)}`}
          className="underline-offset-4 hover:underline"
        >
          Otevřít v sekci Objednávky →
        </Link>
        {/*
          Export objednávek klienta (Jakub, 23. 9. 2026) — smí každý, kdo
          vidí kartu. Obyčejný odkaz, ne serverová akce: prohlížeč má
          soubor stáhnout. Oprávnění hlídá `objednavky/route.ts`.
        */}
        {objednavky.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={`/klienti/${encodeURIComponent(klientId)}/objednavky`}>
              <Download />
              Stáhnout do tabulky
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}

/** Stav účtu do klientské části jednou větou pro řádek na kartě. */
function popisKlientskeCasti(
  stav: ReturnType<typeof stavUctu>,
  ucet: { invitedAt: Date; lastLoginAt: Date | null } | null,
): string {
  switch (stav) {
    case "zadny":
      return "Nemá účet";
    case "zrusen":
      return "Přístup zrušený";
    case "pozvan":
      return `Pozvánka odeslána ${formatDatum(ucet!.invitedAt)}`;
    case "aktivni":
      return ucet?.lastLoginAt
        ? `Aktivní, poslední přihlášení ${formatDatum(ucet.lastLoginAt)}`
        : "Aktivní, zatím bez přihlášení";
  }
}

/** Jak se zpráva klientovi doručila (`client_messages.delivery`). */
const POPIS_DORUCENI_ZPRAVY: Record<string, string> = {
  OZNAMENI: "doručeno oznámením",
  EMAIL: "doručeno e-mailem",
  JEN_UCET: "jen v klientské části",
};
