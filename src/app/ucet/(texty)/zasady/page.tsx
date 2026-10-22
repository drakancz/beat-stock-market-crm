import type { Metadata } from "next";
import Link from "next/link";

import { Kontakt, Nadpis, Oddil, SEZNAM, popisFirmy, udajeFirmy } from "../casti";

export const metadata: Metadata = { title: "Ochrana osobních údajů" };

export const dynamic = "force-dynamic";

/**
 * Zásady ochrany osobních údajů (Jakub, 30. 9. 2026). Informace podle
 * čl. 13 GDPR. **Vidí i nepřihlášený.**
 *
 * Text popisuje, co systém **skutečně** dělá — při každé změně toho, kam
 * údaje odcházejí (nová služba, jiný region), se musí upravit i tady
 * a posunout `PLATNE_OD`. Seznam příjemců odpovídá security.md
 * (oddíly 6 a 7) a proměnným na Railway.
 */
export default async function ZasadyPage() {
  const firma = await udajeFirmy();

  return (
    <>
      <Nadpis>Zásady ochrany osobních údajů</Nadpis>

      <p className="text-sm leading-relaxed">
        Tady se dozvíte, jaké osobní údaje o vás zpracováváme, proč, jak dlouho a jaká máte práva.
        Týká se to vás jako našeho zákazníka i klientské části, do které se přihlašujete.
      </p>

      <Oddil nazev="1. Kdo vaše údaje zpracovává">
        <p>
          Správcem osobních údajů je {popisFirmy(firma)}. S čímkoli, co se týká vašich údajů, se na
          nás obraťte <Kontakt email={firma.kontakt} />.
        </p>
      </Oddil>

      <Oddil nazev="2. Jaké údaje o vás máme">
        <ul className={SEZNAM}>
          <li>jméno a příjmení, e-mail a telefon, pokud jste ho uvedli,</li>
          <li>
            objednávky: co jste objednali, za kolik, kdy, jestli je zaplaceno, do kdy vám platí
            členství a jestli máte přístup do programu,
          </li>
          <li>brokery, které jste uvedli při objednávce (nebo že žádného nemáte),</li>
          <li>jestli souhlasíte se zasíláním novinek, a od kdy,</li>
          <li>poznámky našeho týmu z komunikace s vámi,</li>
          <li>
            údaje o účtu v klientské části: kdy jste se naposledy přihlásili a jestli máte zapnuté
            dvoufázové ověření. Vaše heslo neznáme — ukládáme jen jeho nevratný otisk.
          </li>
          <li>
            zprávy, které jsme vám poslali do klientské části, a zařízení, na kterých jste si
            povolili oznámení (jen technická adresa pro doručení a typ zařízení, třeba „iPhone ·
            Safari“).
          </li>
          <li>
            vzdělávání: které lekce máte hotové, účast na webinářích, získané odznaky a týdny, kdy
            jste klientskou část otevřeli (jen týden, nic dalšího o návštěvě).
          </li>
        </ul>
      </Oddil>

      <Oddil nazev="3. Proč údaje zpracováváme">
        <ul className={SEZNAM}>
          <li>
            <strong>Vyřízení objednávky a poskytnutí služby</strong> — abychom vám mohli dodat, co
            jste si objednali, zpřístupnit program a klientskou část (plnění smlouvy, čl. 6 odst. 1
            písm. b GDPR).
          </li>
          <li>
            <strong>Účetnictví a daně</strong> — údaje o platbách musíme uchovávat ze zákona (právní
            povinnost, písm. c).
          </li>
          <li>
            <strong>Péče o zákazníky a bezpečnost</strong> — abychom vám mohli pomoci, pamatovali
            si, co jsme spolu řešili, a chránili účty před zneužitím (oprávněný zájem, písm. f).
          </li>
          <li>
            <strong>Zasílání novinek e-mailem</strong> — jen pokud jste s tím souhlasili (souhlas,
            písm. a). Souhlas můžete kdykoli odvolat v klientské části v Mém profilu nebo odkazem v
            každém e-mailu s novinkami.
          </li>
        </ul>
        <p>Nic z toho není automatizované rozhodování ani profilování s právními účinky pro vás.</p>
      </Oddil>

      <Oddil nazev="4. Jak dlouho údaje uchováváme">
        <ul className={SEZNAM}>
          <li>
            po dobu, kdy jste naším zákazníkem, a poté jen tak dlouho, jak je potřeba k vyřízení
            případných nároků,
          </li>
          <li>
            doklady o platbách tak dlouho, jak ukládají účetní a daňové předpisy (zpravidla 10 let),
          </li>
          <li>souhlas se zasíláním novinek do doby, než ho odvoláte.</li>
        </ul>
      </Oddil>

      <Oddil nazev="5. Komu údaje předáváme">
        <p>Vaše údaje neprodáváme. Pomáhají nám s nimi tito zpracovatelé:</p>
        <ul className={SEZNAM}>
          <li>
            <strong>Railway</strong> — provoz serveru a databáze, na kterých systém běží (datové
            centrum v Evropské unii),
          </li>
          <li>
            <strong>SmartEmailing</strong> — rozesílání novinek, jen pokud máte souhlas (e-mail a
            jméno),
          </li>
          <li>
            <strong>Amazon Web Services</strong> — odesílání e-mailů ze systému, například pozvánky
            nebo odkazu na nové heslo (Evropská unie),
          </li>
          <li>
            <strong>Sentry</strong> — hlášení technických chyb aplikace; e-maily a telefony se do
            nich nedostanou (Evropská unie),
          </li>
          <li>
            <strong>UploadThing</strong> — úložiště souborů, které k vašemu záznamu přiloží náš tým;
            soubory jsou uložené v USA,
          </li>
          <li>
            <strong>Anthropic</strong> — nástroj umělé inteligence, který náš tým používá k práci s
            přehledy objednávek a klientů; e-maily ani telefony do něj nepředáváme (USA).
          </li>
          <li>
            <strong>Google, Apple, Mozilla a Microsoft</strong> — doručení oznámení do vašeho
            telefonu nebo prohlížeče, jen pokud jste si je povolili. Obsah oznámení je šifrovaný,
            tyto služby ho nepřečtou; podle toho, jaký prohlížeč používáte, může jít o servery mimo
            Evropskou unii.
          </li>
          <li>
            <strong>Google (YouTube) a Vimeo</strong> — přehrání videí v kurzech a členské sekci.
            Přehrávač se načte, až když stránku s videem otevřete, v režimu bez sledovacích cookies;
            služba uvidí vaši IP adresu a prohlížeč (USA).
          </li>
          <li>
            <strong>GoPay</strong> — platby kartou a převodem; dostane váš e-mail, číslo objednávky,
            produkty a částku. Údaje o kartě zadáváte přímo GoPay, my je nevidíme (Česká republika),
          </li>
          <li>
            <strong>Google (Kalendář)</strong> — termíny konzultací v našem firemním kalendáři;
            dostane vaše jméno a čas konzultace, e-mail ani telefon ne (USA),
          </li>
          <li>
            <strong>Služby pro propojení systémů</strong> (například Zapier) — jméno a údaje o
            objednávce, rezervaci konzultace nebo dokončeném kurzu, abychom je mohli zpracovat v
            dalších nástrojích, například v účetnictví. E-maily ani telefony nepředáváme. Kterou
            službu právě používáme, vám na požádání sdělíme.
          </li>
        </ul>
        <p>
          U zpracovatelů mimo Evropskou unii se předání opírá o nástroje, které k tomu GDPR
          předepisuje (například standardní smluvní doložky). Údaje dále předáváme úřadům, jen když
          to ukládá zákon.
        </p>
      </Oddil>

      <Oddil nazev="6. Vaše práva">
        <p>Máte právo:</p>
        <ul className={SEZNAM}>
          <li>
            vědět, jaké údaje o vás máme, a dostat jejich kopii — stáhnete si ji sami v klientské
            části v Mém profilu (PDF k přečtení i JSON pro přenesení k jinému správci),
          </li>
          <li>
            nechat je opravit — jméno, telefon a souhlas si změníte sami v klientské části v Mém
            profilu,
          </li>
          <li>na výmaz, pokud je už nepotřebujeme nebo zpracování nemá právní důvod,</li>
          <li>na omezení zpracování a na přenesení údajů k jinému správci,</li>
          <li>vznést námitku proti zpracování z oprávněného zájmu,</li>
          <li>kdykoli odvolat souhlas se zasíláním novinek.</li>
        </ul>
        <p>
          Stačí nám napsat <Kontakt email={firma.kontakt} />. Odpovíme nejpozději do jednoho měsíce.
          Pokud nebudete spokojeni, můžete si stěžovat u Úřadu pro ochranu osobních údajů, Pplk.
          Sochora 27, 170 00 Praha 7,{" "}
          <a href="https://uoou.gov.cz" className="underline" rel="noopener noreferrer">
            uoou.gov.cz
          </a>
          .
        </p>
      </Oddil>

      <Oddil nazev="7. Cookies a zabezpečení">
        <p>
          Klientská část používá jedinou cookie — tu, která si pamatuje vaše přihlášení. Žádné
          analytické ani reklamní cookies nepoužíváme.
        </p>
        <p>
          Spojení je šifrované, heslo ukládáme jen jako nevratný otisk a k údajům má přístup jen náš
          tým. Pro vyšší bezpečnost si v Mém profilu můžete zapnout dvoufázové ověření.
        </p>
      </Oddil>

      <Oddil nazev="8. Změny zásad">
        <p>
          Když zásady změníme, aktuální znění najdete vždy tady. Související jsou{" "}
          <Link href="/ucet/podminky" className="underline">
            Podmínky používání klientské části
          </Link>
          .
        </p>
      </Oddil>
    </>
  );
}
