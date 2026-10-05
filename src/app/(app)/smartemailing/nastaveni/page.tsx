import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, ListChecks, Send, UserMinus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDatumCas } from "@/lib/format";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  adresaWebhooku,
  hesloWebhooku,
  nactiSeznamyOdberatelu,
  nactiWebhook,
  smartemailingNastaveny,
} from "@/lib/smartemailing";

import { FormularSmartemailingu, ZkouskaSpojeni } from "./formular";
import { PrijemOdhlaseni } from "./prijem-odhlaseni";

export const metadata: Metadata = { title: "Nastavení propojení" };

export const dynamic = "force-dynamic";

/**
 * SmartEmailing → Nastavení propojení (Jakub, 13. 9. 2026; do 13. 9. večer
 * bylo v Nastavení → SmartEmailing, stará adresa přesměrovává).
 *
 * **Vidí i mění jen administrátor.** Přihlašovací údaje jsou v `.env`
 * a tady se ukazuje jen to, jestli jsou vyplněné (security_warnings.md,
 * pravidlo 3). Seznamy odběratelů se načítají živě ze SmartEmailingu.
 */
export default async function NastaveniPropojeniPage() {
  await requireAdmin();

  const nastaveny = smartemailingNastaveny();
  const [nastaveni, seznamy] = await Promise.all([
    nactiNastaveni(),
    nastaveny ? nactiSeznamyOdberatelu() : null,
  ]);

  // Příjem odhlášení (webhook, Jakub 15. 9. 2026). Stav se čte živě ze
  // SmartEmailingu — webhook tam může někdo smazat, nebo ho SmartEmailing
  // po opakovaných chybách vypne.
  const webhookId = nastaveni.smartemailingWebhookId;
  const stavWebhooku = nastaveny && webhookId !== null ? await nactiWebhook(webhookId) : null;
  const hesloVyplnene = hesloWebhooku() !== null;
  const adresa = adresaWebhooku();
  const webhookChybi = stavWebhooku?.ok === true && stavWebhooku.data === null;
  const webhookVypnuty = stavWebhooku?.ok === true && stavWebhooku.data?.aktivni === false;

  // Seznam mohl někdo ve SmartEmailingu smazat. Klienti pak potichu končí
  // v sekci Chyby, proto to musí být vidět hned nahoře (Jakub, 13. 9. 2026).
  const seznamyNacteny = seznamy?.ok === true;
  const seznamZmizel =
    seznamyNacteny &&
    nastaveni.smartemailingListId !== null &&
    !seznamy.data.some((seznam) => seznam.id === nastaveni.smartemailingListId);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Noví klienti do SmartEmailingu
            {nastaveni.smartemailingEnabled ? (
              <Badge variant="secondary">Zapnuto</Badge>
            ) : (
              <Badge variant="outline">Vypnuto</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Když obchodník založí klienta se souhlasem s marketingem nebo takový klient přijde z
            formuláře na webu, systém ho sám zapíše do vybraného seznamu odběratelů.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {seznamy && !seznamy.ok && (
            <Alert variant="destructive">
              <AlertTitle>Seznamy se nepodařilo načíst</AlertTitle>
              <AlertDescription>
                {POPIS_CHYBY_SMARTEMAILINGU[seznamy.chyba]}. Zkontroluj přihlašovací údaje tlačítkem
                níž, nebo to zkus za chvíli znovu.
              </AlertDescription>
            </Alert>
          )}

          {seznamZmizel && (
            <Alert variant="destructive">
              <AlertTitle>Vybraný seznam ve SmartEmailingu už není</AlertTitle>
              <AlertDescription>
                Seznam „{nastaveni.smartemailingListName ?? nastaveni.smartemailingListId}“ ve
                SmartEmailingu někdo smazal. Noví klienti se souhlasem teď končí v chybách odeslání.
                Vyber jiný seznam, ulož a chyby pak spusť znovu v záložce{" "}
                <Link href="/smartemailing/chyby?druh=smartemailing" className="underline">
                  Chyby
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

          <FormularSmartemailingu
            zapnuto={nastaveni.smartemailingEnabled}
            seznamId={nastaveni.smartemailingListId}
            nazevSeznamu={nastaveni.smartemailingListName}
            seznamy={seznamy?.ok ? seznamy.data : []}
            seznamyNacteny={seznamyNacteny}
            nastaveny={nastaveny}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserMinus className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Příjem odhlášení
            {webhookId !== null ? (
              <Badge variant="secondary">Zapnuto</Badge>
            ) : (
              <Badge variant="outline">Vypnuto</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Když se klient ve SmartEmailingu odhlásí z vybraného seznamu, SmartEmailing to hned
            pošle do CRM. Klientovi se odebere souhlas s marketingem a na kartě se ukáže datum
            odhlášení. Kdo má jen nedoručitelný e-mail, souhlas si nechá a objeví se v seznamu
            Špatný e-mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hesloVyplnene && (
            <Alert variant="destructive">
              <AlertTitle>Chybí heslo pro příjem odhlášení</AlertTitle>
              <AlertDescription>
                Doplň do <code>.env</code> hodnotu <code>SMARTEMAILING_WEBHOOK_SECRET</code> (aspoň
                32 znaků) a restartuj aplikaci. Bez něj CRM žádnou zprávu nepřijme.
              </AlertDescription>
            </Alert>
          )}

          {!adresa.ok && (
            <Alert>
              <AlertTitle>Funguje až po nasazení</AlertTitle>
              <AlertDescription>
                {adresa.duvod} SmartEmailing by zprávy posílal na <code>{adresa.adresa}</code>. Do
                té doby načítej odhlášené tlačítkem v Synchronizaci kontaktů.
              </AlertDescription>
            </Alert>
          )}

          {stavWebhooku && !stavWebhooku.ok && (
            <Alert variant="destructive">
              <AlertTitle>Stav webhooku se nepodařilo načíst</AlertTitle>
              <AlertDescription>
                {POPIS_CHYBY_SMARTEMAILINGU[stavWebhooku.chyba]}. Zkus stránku za chvíli obnovit.
              </AlertDescription>
            </Alert>
          )}

          {webhookChybi && (
            <Alert variant="destructive">
              <AlertTitle>Webhook ve SmartEmailingu už není</AlertTitle>
              <AlertDescription>
                Někdo ho ve SmartEmailingu smazal, odhlášení teď do CRM nechodí. Zapni příjem znovu.
              </AlertDescription>
            </Alert>
          )}

          {webhookVypnuty && (
            <Alert variant="destructive">
              <AlertTitle>SmartEmailing webhook vypnul</AlertTitle>
              <AlertDescription>
                Nejspíš po opakovaných chybách při doručení. Zkontroluj záložku Chyby a zapni příjem
                znovu.
              </AlertDescription>
            </Alert>
          )}

          {stavWebhooku?.ok && stavWebhooku.data && (
            <ul className="text-muted-foreground space-y-1 text-sm">
              <li>
                Adresa: <code className="text-foreground">{adresa.adresa}</code>
              </li>
              <li>
                Naposledy volal:{" "}
                <span className="text-foreground">
                  {stavWebhooku.data.posledniVolani
                    ? `${formatDatumCas(stavWebhooku.data.posledniVolani)}${
                        stavWebhooku.data.posledniKod
                          ? `, odpověď ${stavWebhooku.data.posledniKod}`
                          : ""
                      }`
                    : "zatím nikdy"}
                </span>
              </li>
              {stavWebhooku.data.chybVRade > 0 && (
                <li className="text-destructive">
                  Posledních {stavWebhooku.data.chybVRade} doručení skončilo chybou.
                </li>
              )}
            </ul>
          )}

          <PrijemOdhlaseni
            zapnuto={webhookId !== null}
            lzeZapnout={
              nastaveny && hesloVyplnene && adresa.ok && nastaveni.smartemailingListId !== null
            }
            znovu={webhookChybi || webhookVypnuty}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Přihlašovací údaje
            {nastaveny ? (
              <Badge variant="secondary">Nastavené</Badge>
            ) : (
              <Badge variant="destructive">Chybí</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Jsou v souboru <code>.env</code> pod názvy <code>SMARTEMAILING_USERNAME</code> (e-mail
            do SmartEmailingu) a <code>SMARTEMAILING_API_KEY</code>. V systému se schválně nikde
            nezobrazují a nejde je odsud změnit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nastaveny ? (
            <ZkouskaSpojeni />
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Do SmartEmailingu teď nic neodchází</AlertTitle>
              <AlertDescription>
                Klíč najdeš ve SmartEmailingu v Nastavení účtu → API klíče. Po doplnění do{" "}
                <code>.env</code> je potřeba restartovat aplikaci.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Co a kdy se posílá
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground space-y-1.5 text-sm">
            <li>
              <strong className="text-foreground">Automaticky nový klient</strong> se souhlasem s
              marketingem — založený ve formuláři v CRM i přijatý z formuláře na webu. Bez souhlasu
              neodejde nic.
            </li>
            <li>
              <strong className="text-foreground">Úprava klienta se propisuje:</strong> zaškrtnutý
              souhlas klienta přihlásí, odebraný souhlas ho ze seznamu odhlásí a nový e-mail se
              přihlásí místo starého, který se odhlásí. Rozhoduje souhlas v CRM — přihlásí i toho,
              kdo se ve SmartEmailingu dřív odhlásil.
            </li>
            <li>
              <strong className="text-foreground">Hromadně</strong> jde v Synchronizaci kontaktů
              poslat klienty se souhlasem, kteří ještě neodešli, včetně leadů z webu.
            </li>
            <li>
              <strong className="text-foreground">Jen e-mail, jméno a příjmení.</strong> Telefon ani
              poznámka z CRM neodcházejí.
            </li>
            <li>
              <strong className="text-foreground">Kdo se z kampaní dřív odhlásil</strong>, zůstane
              při automatickém a hromadném odeslání odhlášený. Odhlášené jde v Synchronizaci
              kontaktů načíst zpátky do CRM — odebere se jim souhlas. Se zapnutým příjmem odhlášení
              se to děje samo, hned po odhlášení.
            </li>
            <li>
              <strong className="text-foreground">Nepropisuje se:</strong> souhlas z webu u klienta,
              kterého už v CRM máme, a smazání klienta.
            </li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
