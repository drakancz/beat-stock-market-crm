import type { Metadata } from "next";
import Link from "next/link";

import { OBCHODNI_PODMINKY_OD } from "@/lib/klient/obchodni-podminky";

import { Kontakt, Nadpis, Oddil, SEZNAM, popisFirmy, udajeFirmy } from "../casti";

export const metadata: Metadata = { title: "Obchodní podmínky" };

export const dynamic = "force-dynamic";

/**
 * Obchodní podmínky pro nákup v klientské části (Jakub, 20. 10. 2026).
 * **Vidí i nepřihlášený** — zákazník je má mít k dispozici před nákupem.
 * Souhlas se zaškrtává v okně Koupit a ukládá se k objednávce i se zněním
 * (`OBCHODNI_PODMINKY_OD` — při změně textu ho posuň).
 *
 * Návrh od Clauda podle toho, co aplikace skutečně dělá. **Ke kontrole
 * právníkem**, Claude není advokát. Údaje o firmě se berou z Nastavení.
 */
export default async function ObchodniPodminkyPage() {
  const firma = await udajeFirmy();

  return (
    <>
      <Nadpis platneOd={OBCHODNI_PODMINKY_OD}>Obchodní podmínky</Nadpis>

      <Oddil nazev="1. Kdo prodává a čeho se podmínky týkají">
        <p>
          Prodávajícím je {popisFirmy(firma)}. Ozvat se nám můžete <Kontakt email={firma.kontakt} />
          .
        </p>
        <p>
          Tyto podmínky platí pro nákupy v klientské části — prodloužení členství, online kurzy a
          konzultace. Kupujete jako spotřebitel. Na co podmínky nepamatují, řídí se občanským
          zákoníkem.
        </p>
      </Oddil>

      <Oddil nazev="2. Co prodáváme">
        <ul className={SEZNAM}>
          <li>
            <strong>Členství</strong> — přístup k obsahu pro členy po dobu uvedenou u produktu.
            Platí od zaplacení; když prodloužíte před koncem, nová doba navazuje na tu dosavadní a o
            žádné dny nepřijdete.
          </li>
          <li>
            <strong>Online kurz</strong> — lekce v klientské části, přístup bez časového omezení po
            dobu, kdy klientskou část provozujeme.
          </li>
          <li>
            <strong>Konzultace</strong> — jednorázová služba. Termín si po zaplacení vyberete v
            klientské části z vypsaných termínů.
          </li>
        </ul>
        <p>
          Ceny jsou uvedené včetně DPH. Cenu, za kterou kupujete, vidíte v okně nákupu před
          odesláním objednávky, včetně případné slevy ze slevového kódu.
        </p>
      </Oddil>

      <Oddil nazev="3. Objednávka">
        <p>
          Objednávku odešlete tlačítkem Objednat poté, co potvrdíte souhlas s těmito podmínkami.
          Odesláním objednávky vzniká kupní smlouva. Objednávka se vám hned ukáže v Přehledu.
          Nezaplacenou objednávku můžete kdykoli zrušit — stačí nám napsat.
        </p>
      </Oddil>

      <Oddil nazev="4. Platba">
        <ul className={SEZNAM}>
          <li>
            <strong>Kartou</strong> přes platební bránu, pokud ji u objednávky nabízíme.
          </li>
          <li>
            <strong>Převodem</strong> na náš účet. Číslo účtu, částku, variabilní symbol a QR kód
            najdete po objednání; jako variabilní symbol použijte číslo objednávky.
          </li>
        </ul>
        <p>Po zaplacení vystavíme fakturu, kterou si stáhnete v klientské části.</p>
      </Oddil>

      <Oddil nazev="5. Zpřístupnění">
        <p>
          Obsah vám zpřístupníme v klientské části bez zbytečného odkladu po přijetí platby — při
          platbě kartou hned, při převodu zpravidla do 2 pracovních dnů od připsání na náš účet. O
          zaplacení vám dáme vědět.
        </p>
        <p>
          Konzultaci můžete zrušit nebo přeložit v klientské části nejpozději 24 hodin před jejím
          začátkem.
        </p>
      </Oddil>

      <Oddil nazev="6. Odstoupení od smlouvy">
        <p>
          Jako spotřebitel můžete od smlouvy odstoupit bez udání důvodu do 14 dnů od jejího
          uzavření. Stačí nám to napsat <Kontakt email={firma.kontakt} />, můžete použít vzor níže.
        </p>
        <p>
          <strong>Kdy právo odstoupit zaniká:</strong>
        </p>
        <ul className={SEZNAM}>
          <li>
            u <strong>členství a online kurzu</strong> (digitální obsah) zpřístupněním obsahu,
            protože jste při objednávce výslovně požádali o zpřístupnění hned po zaplacení a vzali
            na vědomí, že tím právo odstoupit ztrácíte;
          </li>
          <li>
            u <strong>konzultace</strong> jejím uskutečněním, pokud proběhla na vaši žádost během
            lhůty pro odstoupení. Když odstoupíte až po jejím začátku, zaplatíte poměrnou část ceny.
          </li>
        </ul>
        <p>
          Peníze vám vrátíme do 14 dnů od odstoupení stejným způsobem, jakým jste platili, pokud se
          nedohodneme jinak. O vrácení vystavíme opravný daňový doklad.
        </p>
      </Oddil>

      <Oddil nazev="7. Když něco nefunguje (reklamace)">
        <p>
          Pokud vám obsah nejde otevřít, nefunguje nebo neodpovídá popisu, napište nám{" "}
          <Kontakt email={firma.kontakt} /> a popište, co se děje. Reklamaci vyřídíme nejpozději do
          30 dnů — obsah opravíme nebo zpřístupníme znovu, a když to nejde, přiměřeně snížíme cenu
          nebo ji vrátíme.
        </p>
      </Oddil>

      <Oddil nazev="8. Nejde o investiční doporučení">
        <p>
          Kurzy, členský obsah i konzultace jsou vzdělávání. Nejsou investičním poradenstvím ani
          doporučením ke koupi či prodeji investičních nástrojů. O svých investicích rozhodujete
          sami a na vlastní odpovědnost.
        </p>
      </Oddil>

      <Oddil nazev="9. Spory">
        <p>
          Když se nedohodneme, můžete se obrátit na Českou obchodní inspekci, která řeší spory
          spotřebitelů mimosoudně (
          <a href="https://adr.coi.cz" target="_blank" rel="noopener" className="underline">
            adr.coi.cz
          </a>
          ). Dozor nad dodržováním předpisů na ochranu spotřebitele vykonává Česká obchodní
          inspekce.
        </p>
      </Oddil>

      <Oddil nazev="10. Osobní údaje">
        <p>
          Jak zacházíme s vašimi údaji, popisují{" "}
          <Link href="/ucet/zasady" className="underline">
            Zásady ochrany osobních údajů
          </Link>
          . Klientskou část samotnou upravují{" "}
          <Link href="/ucet/podminky" className="underline">
            Podmínky používání
          </Link>
          .
        </p>
      </Oddil>

      <Oddil nazev="11. Závěr">
        <p>
          Podmínky můžeme změnit. Pro vaši objednávku platí znění, se kterým jste souhlasili při
          objednání — ukládáme si ho k objednávce. Smlouva se řídí právem České republiky a uzavírá
          se v češtině.
        </p>
      </Oddil>

      <Oddil nazev="Vzor: odstoupení od smlouvy">
        <div className="bg-muted/50 space-y-2 rounded-lg border p-4">
          <p>Adresát: {popisFirmy(firma)}</p>
          <p>
            Oznamuji, že odstupuji od smlouvy o koupi: ______ (produkt), číslo objednávky ______,
            objednáno dne ______.
          </p>
          <p>Jméno a příjmení: ______</p>
          <p>E-mail, se kterým se přihlašuji do klientské části: ______</p>
          <p>Číslo účtu pro vrácení peněz (při platbě převodem): ______</p>
          <p>Datum: ______</p>
        </div>
      </Oddil>
    </>
  );
}
