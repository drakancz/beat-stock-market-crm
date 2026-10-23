import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CircleAlert,
  CopyCheck,
  Download,
  History,
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
import { nactiKonzultaceKlienta } from "@/lib/konzultace";
import { pocet } from "@/lib/mnozne";
import { nactiStitky } from "@/lib/stitky";
import { nactiPoleKlienta } from "@/lib/vlastni-pole";
import { nactiBodyKlientu } from "@/lib/vzdelavani/body";
import { nactiVzdelavaniKlienta } from "@/lib/vzdelavani/klient";
import { isoTyden } from "@/lib/vzdelavani/odznaky";
import { aktualniHraniceNechodi, nechodi } from "@/lib/nechodi";

import { KlientDialog } from "../klient-dialog";
import { SmazaniKlienta } from "../smazani-klienta";

import { CasovaOsa } from "./casova-osa";
import { HlidaniSmartemailingu } from "./hlidani-smartemailingu";
import { KlientskaCast } from "./klientska-cast";
import { StitkyKlienta } from "./stitky-klienta";
import { OknoKarty } from "./okno-karty";
import { PoslatDoSmartemailingu } from "./poslat-do-smartemailingu";
import { PoznamkyKlienta } from "./poznamky-klienta";
import { UpravaPlatnosti } from "./uprava-platnosti";
import { VlastniPoleKlienta } from "./vlastni-pole";
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
 * Poznámky (· Zprávy · Časová osa od 16. 10. 2026, okno), pod tím Údaje.
 * Záložky Časová osa, Hovory, Portfolia,
 * Objednávky a Úkoly zmizely; stav klienta se na kartě neukazuje (zůstal
 * ve formuláři Upravit). Úkoly jsou na Dashboardu v Mém dni. Hovory
 * z CRM zmizely úplně 20. 10. 2026. Z databáze se tím nic nemazalo.
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
        lastSeenAt: true,
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
  const [vzdelavani, bodyKlientu, vlastniPole, konzultace] = await Promise.all([
    nactiVzdelavaniKlienta(klient.id),
    nactiBodyKlientu([klient.id]),
    nactiPoleKlienta(klient.id),
    // Konzultace (5B, 19. 10. 2026) — vidí každý, kdo vidí kartu.
    nactiKonzultaceKlienta(klient.id),
  ]);
  const body = bodyKlientu.get(klient.id)!;
  // Kdo klienta přivedl (5A, 15. 10. 2026) — vidí každý, kdo vidí kartu.
  // Odměnu z jeho objednávky jen administrátor.
  const [doporuceni, odmeny] = await Promise.all([
    db.client.findUnique({
      where: { id: klient.id },
      select: {
        referredBy: {
          select: { name: true, client: { select: { id: true, name: true, deletedAt: true } } },
        },
      },
    }),
    jeAdmin
      ? db.referralReward.findMany({
          where: { order: { clientId: klient.id } },
          select: { amount: true, currency: true, paidOutAt: true },
        })
      : Promise.resolve([]),
  ]);
  const privedl = doporuceni?.referredBy ?? null;

  // Aktivita klienta (Fáze 5B, 15. 10. 2026) — vidí každý, kdo vidí kartu.
  const ted = new Date();
  const [aktivnichTydnu, lekciZa30Dni, { dni: hraniceDni, hranice }] = await Promise.all([
    db.clientActiveWeek.count({
      where: {
        clientId: klient.id,
        week: {
          in: Array.from({ length: 12 }, (_, tydnu) =>
            isoTyden(new Date(ted.getTime() - tydnu * 7 * 86_400_000)),
          ),
        },
      },
    }),
    db.lessonProgress.count({
      where: {
        clientId: klient.id,
        completedAt: { gte: new Date(ted.getTime() - 30 * 86_400_000) },
      },
    }),
    aktualniHraniceNechodi(),
  ]);
  const klientNechodi = nechodi(
    {
      beziClenstvi: platnosti.some((platnost) => !platnost.skoncilo),
      posledniNavsteva: ucet?.lastSeenAt ?? null,
      posledniPlatba:
        objednavky
          .filter((objednavka) => objednavka.status === "ZAPLACENO" && objednavka.paidAt)
          .map((objednavka) => objednavka.paidAt!)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    },
    hranice,
  );
  // Štítky (Fáze 5B, 11. 10. 2026) — přidat a odebrat smí každý přihlášený.
  const [stitkyKlienta, vsechnyStitky] = await Promise.all([
    db.clientTagLink.findMany({
      where: { clientId: klient.id, tag: { deletedAt: null } },
      orderBy: { tag: { name: "asc" } },
      select: { tag: { select: { id: true, name: true, color: true } } },
    }),
    nactiStitky(),
  ]);

  // Čerstvě založený klient se souhlasem: odeslání do SmartEmailingu ještě
  // běží, karta se proto sama obnoví, až bude výsledek (Jakub, 15. 9. 2026).
  const hlidatSmartemailing = cekaNaOdeslani(klient, nastaveni);

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
          <Button variant="outline" disabled title="Posílání e-mailů přímo z karty se připravuje.">
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
            zdroje={zdroje}
            klient={{
              id: klient.id,
              name: klient.name,
              email: klient.email ?? "",
              phone: klient.phone ?? "",
              sourceId: klient.sourceId,
              stage: klient.stage,
              souhlasMarketing: klient.consentMarketingAt !== null,
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

          {/* Časová osa (Fáze 5B, Jakub 16. 10. 2026): vidí každý, kdo vidí
              kartu; druh Změny (audit) jen administrátor — hlídá server. */}
          <OknoKarty
            tlacitko="Časová osa"
            ikona={<History />}
            nadpis="Časová osa"
            popis={`Co se u klienta ${klient.name} dělo, od nejnovějšího.`}
          >
            <CasovaOsa klientId={klient.id} jeAdmin={jeAdmin} />
          </OknoKarty>
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
        a souhlas s marketingem. Zdroj, V systému od
        a Poslední kontakt zmizely. Řádky SmartEmailingu zůstaly, patří
        k souhlasu s marketingem.
      */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Údaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-muted-foreground shrink-0 text-xs">Štítky</span>
            <StitkyKlienta
              klientId={klient.id}
              klientJmeno={klient.name}
              maji={stitkyKlienta.map((vazba) => vazba.tag)}
              vsechny={vsechnyStitky}
            />
          </div>
          <Row label="E-mail" value={klient.email} />
          <Row label="Telefon" value={klient.phone ? formatTelefon(klient.phone) : "—"} />
          {/*
            Co klient sám uvedl při objednávce nebo na webu — jen informace,
            do CRM se z toho nic nezakládá (Jakub, 25. 9. 2026). Řádek je jen
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
          {/* Doporučení (5A, 15. 10. 2026): řádek jen u přivedeného klienta. */}
          {privedl && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-muted-foreground shrink-0 text-xs">Přivedl</span>
              <span className="text-right">
                {privedl.client && !privedl.client.deletedAt ? (
                  <Link
                    href={`/klienti/${privedl.client.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {privedl.client.name}
                  </Link>
                ) : (
                  <span className="font-medium">{privedl.name}</span>
                )}
                {odmeny.map((odmena, poradi) => (
                  <span key={poradi} className="text-muted-foreground block text-xs">
                    Odměna {formatMoney(odmena.amount.toNumber(), odmena.currency)} ·{" "}
                    {odmena.paidOutAt ? `vyplaceno ${formatDatum(odmena.paidOutAt)}` : "k výplatě"}
                  </span>
                ))}
              </span>
            </div>
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
            Aktivita (Fáze 5B, Jakub 15. 10. 2026): vidí každý, kdo vidí
            kartu. O návštěvě se ukládá jen poslední čas a týden.
          */}
          <Row
            label="Naposledy v klientské části"
            value={
              !ucet
                ? "Nemá účet"
                : ucet.lastSeenAt
                  ? formatDatumCas(ucet.lastSeenAt)
                  : "Zatím nikdy"
            }
          />
          <Row label="Aktivní týdny" value={`${aktivnichTydnu} z posledních 12`} />
          <Row label="Dokončené lekce za 30 dní" value={String(lekciZa30Dni)} />
          {konzultace.zaplaceno > 0 && (
            <Row
              label="Konzultace"
              value={`zaplaceno ${konzultace.zaplaceno}, využito ${konzultace.vyuzito}${
                konzultace.pristi ? `, příští ${formatDatumCas(konzultace.pristi)}` : ""
              }`}
            />
          )}
          {klientNechodi && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-muted-foreground shrink-0 text-xs">Aktivita</span>
              <span className="text-right">
                <Badge variant="outline">Nechodí</Badge>
                <span className="text-muted-foreground block text-xs">
                  Platí členství, ale přes {pocet(hraniceDni, "den", "dny", "dní")} bez návštěvy
                  klientské části i bez platby.
                </span>
              </span>
            </div>
          )}
          {/* Vlastní pole (Fáze 5B, Jakub 18. 10. 2026): vidí i vyplňuje každý přihlášený. */}
          {vlastniPole.length > 0 && (
            <>
              <Separator />
              <VlastniPoleKlienta klientId={klient.id} pole={vlastniPole} />
            </>
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
          {/* Kvízy a certifikáty (Fáze 5C, Jakub 11. 10. 2026): vidí každý, kdo vidí kartu. */}
          <Row
            label="Kvízy"
            value={
              vzdelavani.kvizy.length > 0
                ? vzdelavani.kvizy
                    .map(
                      (kviz) =>
                        `${kviz.lekce} ${kviz.nejlepsi.correct}/${kviz.nejlepsi.total} ${
                          kviz.nejlepsi.passed ? "splněno" : "nesplněno"
                        } (${pocet(kviz.pokusu, "pokus", "pokusy", "pokusů")})`,
                    )
                    .join(", ")
                : "—"
            }
          />
          {/* Body a úroveň (Fáze 5C, Jakub 18. 10. 2026): vidí každý, kdo vidí kartu. */}
          <Row label="Body" value={`${body.body} · ${body.uroven.nazev}`} />
          {/* Hodnocení lekcí (Fáze 5C, Jakub 18. 10. 2026): vidí každý, kdo vidí kartu. */}
          <Row
            label="Hodnocení lekcí"
            value={
              vzdelavani.hodnoceni.length > 0
                ? vzdelavani.hodnoceni
                    .map((hodnoceni) => `${hodnoceni.lekce} ${hodnoceni.hvezd}/5`)
                    .join(", ")
                : "—"
            }
          />
          <Row
            label="Certifikáty"
            value={
              vzdelavani.certifikaty.length > 0
                ? vzdelavani.certifikaty
                    .map(
                      (certifikat) =>
                        `${certifikat.courseTitle} — ${certifikat.number}, ${formatDatum(certifikat.issuedAt)}`,
                    )
                    .join("; ")
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
              {/* Slevový kód (5A, 14. 10. 2026) — částka je už po slevě. */}
              {objednavka.sleva && (
                <span className="text-muted-foreground tabular w-full text-xs">
                  Slevový kód {objednavka.sleva.kod}: −
                  {formatMoney(objednavka.sleva.bezDph, objednavka.currency)} bez DPH
                </span>
              )}
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
