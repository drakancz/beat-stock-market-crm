import type { Metadata } from "next";
import Link from "next/link";

import { Kontakt, Nadpis, Oddil, SEZNAM, popisFirmy, udajeFirmy } from "../casti";

export const metadata: Metadata = { title: "Podmínky" };

export const dynamic = "force-dynamic";

/**
 * Podmínky používání klientské části (Jakub, 30. 9. 2026). **Vidí
 * i nepřihlášený.** Týkají se jen klientské části, ne nákupu — ten se
 * řídí obchodními podmínkami při objednávce na Landing Page.
 *
 * Oddíl 4 je tu kvůli security_warnings.md, pravidlu 9: nic v klientské
 * části nesmí působit jako investiční doporučení.
 */
export default async function PodminkyPage() {
  const firma = await udajeFirmy();

  return (
    <>
      <Nadpis>Podmínky používání klientské části</Nadpis>

      <Oddil nazev="1. O čem tyto podmínky jsou">
        <p>
          Klientskou část provozuje {popisFirmy(firma)} pro své zákazníky. Tyto podmínky říkají, jak
          ji můžete používat. Nákup produktů se řídí obchodními podmínkami, se kterými jste
          souhlasili při objednávce.
        </p>
      </Oddil>

      <Oddil nazev="2. Váš účet">
        <ul className={SEZNAM}>
          <li>
            Účet vám zřizujeme po objednávce — přijde vám pozvánka e-mailem. Veřejná registrace
            neexistuje.
          </li>
          <li>
            Účet je osobní. Heslo nikomu neprozrazujte a nesdílejte ho. Doporučujeme zapnout si
            dvoufázové ověření v Mém profilu.
          </li>
          <li>
            Když máte podezření, že vaše heslo zná někdo další, změňte si ho a dejte nám vědět{" "}
            <Kontakt email={firma.kontakt} />.
          </li>
        </ul>
      </Oddil>

      <Oddil nazev="3. Co v klientské části najdete">
        <p>
          Přehled svých objednávek, do kdy vám platí členství, jestli máte přístup do programu, a
          svoje údaje, které si můžete sami upravit. Údaje jsou informativní — rozhodující je doklad
          o platbě. Když vám něco nesedí, napište nám.
        </p>
      </Oddil>

      <Oddil nazev="4. Nejde o investiční doporučení">
        <p>
          Nic v klientské části ani v našich službách není investičním poradenstvím ani doporučením
          ke koupi či prodeji investičních nástrojů. O svých investicích rozhodujete sami a na
          vlastní odpovědnost.
        </p>
      </Oddil>

      <Oddil nazev="5. Dostupnost">
        <p>
          Snažíme se, aby klientská část fungovala nepřetržitě, ale nemůžeme to zaručit — občas ji
          potřebujeme udržovat nebo může dojít k výpadku.
        </p>
      </Oddil>

      <Oddil nazev="6. Zrušení účtu">
        <p>
          O zrušení účtu můžete kdykoli požádat <Kontakt email={firma.kontakt} />. Přístup můžeme
          zrušit i my, pokud účet někdo zneužívá nebo pokud skončí naše spolupráce. Vaše objednávky
          tím nezanikají.
        </p>
      </Oddil>

      <Oddil nazev="7. Osobní údaje">
        <p>
          Jak zacházíme s vašimi údaji, popisují{" "}
          <Link href="/ucet/zasady" className="underline">
            Zásady ochrany osobních údajů
          </Link>
          .
        </p>
      </Oddil>

      <Oddil nazev="8. Změny podmínek">
        <p>
          Podmínky můžeme změnit; aktuální znění najdete vždy tady. Řídí se právem České republiky.
        </p>
      </Oddil>
    </>
  );
}
