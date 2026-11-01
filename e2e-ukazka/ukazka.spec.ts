import { expect, test, type Page } from "@playwright/test";

import { KROKY_PRUVODCE } from "../src/lib/pruvodce-ukazkou";
import { UKAZKOVY_TYM, VYPNUTO_V_UKAZCE } from "../src/lib/ukazka";
import {
  bezVodorovnehoPosuvu,
  nahodnaAdresa,
  upravUzivatele,
  zalozUzivatele,
} from "../e2e/pomocne";

/**
 * Ukázkový režim (Jakub, 22. 10. 2026; `src/lib/ukazka.ts`):
 * přihlášení jedním klikem, pruh „Ukázka“, ukázková data a zábrany —
 * ukázkový účet nesmí na Správu uživatelů, změnit si heslo ani smazat
 * kartu ukázkového klienta, přes kterou se přihlašují ostatní.
 */

const PRUH = "Ukázka — data jsou vymyšlená";

async function jakoClenTymu(page: Page) {
  // Omezení neúspěšných přihlášení počítá podle adresy — každý test vlastní.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  await page.goto("/prihlaseni");
  await page.getByRole("button", { name: "Vyzkoušet jako člen týmu" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("Ukázka — člen týmu", () => {
  test("přihlásí se jedním klikem a vidí pruh ukázky", { tag: "@telefon" }, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
    await page.goto("/prihlaseni");
    // Údaje jsou na stránce schválně — zájemce je nemá odkud jinak znát.
    await expect(page.getByText(UKAZKOVY_TYM.email)).toBeVisible();
    await expect(page.getByText(UKAZKOVY_TYM.heslo)).toBeVisible();
    // Hlavní oblast pro čtečky obrazovky (Lighthouse, 22. 10. 2026).
    await expect(page.getByRole("main")).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    await page.getByRole("button", { name: "Vyzkoušet jako člen týmu" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(PRUH)).toBeVisible();
    await expect(page.getByText("Vítej, Hoste")).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });

  test("Správa uživatelů pro ukázkový účet neexistuje", async ({ page }) => {
    await jakoClenTymu(page);
    await page.goto("/sprava/uzivatele");
    await expect(page.getByText("Tady nic není")).toBeVisible();

    // Na přehledu Správy chybí odkaz i e-maily kolegů.
    await page.goto("/sprava");
    await expect(page.getByRole("link", { name: "Spravovat uživatele" })).toHaveCount(0);
    await expect(page.getByText("@beatstockmarket.test")).toHaveCount(0);
  });

  test("ve Smazaných nejsou e-maily odložených účtů týmu", async ({ page }) => {
    // Účty týmu noční obnova nemaže, takže na serveru ukázky můžou být
    // i odložení skuteční kolegové (bezpečnostní prohlídka, 23. 10. 2026).
    const kolega = await zalozUzivatele("uzivatel", "Odlozeny");
    await upravUzivatele(kolega.id, { deletedAt: new Date() });

    await jakoClenTymu(page);
    await page.goto("/smazane");
    await expect(page.getByText(kolega.name)).toBeVisible();
    await expect(page.getByText(kolega.email)).toHaveCount(0);
    await expect(page.getByText("@beatstockmarket.test")).toHaveCount(0);
  });

  test("heslo ukázkového účtu změnit nejde", async ({ page }) => {
    await jakoClenTymu(page);
    await page.goto("/profil");
    await page.getByLabel("Současné heslo").fill(UKAZKOVY_TYM.heslo);
    await page.getByLabel("Nové heslo", { exact: true }).fill("Nove-heslo-navstevnika-1");
    await page.getByLabel("Nové heslo ještě jednou").fill("Nove-heslo-navstevnika-1");
    await page.getByRole("button", { name: "Změnit heslo" }).click();
    await expect(page.getByText(VYPNUTO_V_UKAZCE)).toBeVisible();

    // Pořád platí původní heslo — ostatní návštěvníci se dostanou dovnitř.
    await page.context().clearCookies();
    await jakoClenTymu(page);
  });

  test("kartu ukázkového klienta smazat nejde", async ({ page }) => {
    await jakoClenTymu(page);
    await page.goto("/klienti");
    await page.getByRole("link", { name: "Eva Malá" }).first().click();
    await page.getByRole("button", { name: "Smazat", exact: true }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat klienta" });
    await potvrzeni.getByRole("button", { name: "Smazat", exact: true }).click();
    // Důvod přijde jako upozornění a okno zůstane otevřené (CLAUDE.md, Mazání).
    await expect(page.getByText(/Kartu ukázkového klienta/)).toBeVisible();
    await expect(potvrzeni).toBeVisible();
  });

  test("Asistent AI a nahrávání příloh jsou vypnuté", async ({ page }) => {
    await jakoClenTymu(page);
    await page.goto("/asistent");
    await expect(page.getByText("V ukázce je Asistent AI vypnutý")).toBeVisible();

    await page.goto("/klienti");
    await page.getByRole("link", { name: "Ondřej Kratochvíl" }).first().click();
    await page.getByRole("button", { name: /^Přílohy/ }).click();
    await expect(page.getByText("V ukázce je nahrávání souborů vypnuté")).toBeVisible();
  });

  test(
    "průvodce se při první návštěvě rozbalí a kroky vedou na stránky",
    { tag: "@telefon" },
    async ({ page }, testInfo) => {
      await jakoClenTymu(page);
      const pruvodce = page.getByRole("region", { name: "Co si tu vyzkoušet" });
      await expect(pruvodce).toBeVisible();
      // Stránka, na které se průvodce načetl, se odškrtne sama.
      await expect(pruvodce.getByText("Prošli jste 1 z 6")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Karta klienta (druhý krok) se odškrtne až otevřením karty, ne
      // seznamem; filtr „Nové“ (krok Landing Page) odškrtne i Objednávky.
      // Na počet se čeká po každé stránce — jinak by `goto()` odešel dřív,
      // než se průvodce na pomalejším telefonu načte.
      const ocekavanyPocet = [1, 1, 3, 3, 4, 5];
      for (const [i, krok] of KROKY_PRUVODCE.tym.entries()) {
        const odpoved = await page.goto(krok.href);
        expect(odpoved?.status(), `${krok.href} má existovat`).toBe(200);
        await expect(pruvodce.getByText(`Prošli jste ${ocekavanyPocet[i]} z 6`)).toBeVisible();
      }

      await pruvodce.getByRole("link", { name: "Karta klienta" }).click();
      await page.getByRole("main").getByRole("link", { name: "Eva Malá" }).first().click();
      await expect(page.getByRole("heading", { name: "Eva Malá" })).toBeVisible();
      // Na telefonu se panel po kliknutí na krok sbalí, ať nezakrývá stránku.
      const tlacitko = page.getByRole("button", { name: /Co si vyzkoušet/ });
      if (testInfo.project.name !== "desktop") await tlacitko.click();
      await expect(pruvodce.getByText("Prošli jste 6 z 6")).toBeVisible();

      // Sbalený zůstane i po načtení jiné stránky.
      await pruvodce.getByRole("button", { name: "Sbalit průvodce" }).click();
      await page.goto("/klienti");
      await expect(pruvodce).toHaveCount(0);
      await page.getByRole("button", { name: /Co si vyzkoušet/ }).click();
      await pruvodce.getByRole("button", { name: "Začít znovu" }).click();
      await expect(pruvodce.getByText("Prošli jste 0 z 6")).toBeVisible();
    },
  );

  test("objednávka z Landing Page: přihlášení otevře rovnou ji", async ({ page, request }) => {
    // Stejný klíč jako `ORDER_API_KEY` služby `e2e` v `compose.yaml`.
    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": "e2e-objednavky-klic-nepouzivat-nikde-jinde" },
      data: {
        email: `landing.${Date.now()}@example.test`,
        jmeno: "Návštěvník",
        prijmeni: "Z Landing Page",
        souhlasMarketing: false,
        souhlasPodminky: true,
        nemamBrokera: true,
        produkty: [{ nazev: "BSM - Roční členství" }],
      },
    });
    expect(odpoved.status()).toBe(201);
    const { cislo } = (await odpoved.json()) as { cislo: string };

    // Tak vede odkaz z poděkování na Landing Page (krok 1C).
    await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
    const cil = `/objednavky?hledat=${cislo}`;
    await page.goto(`/prihlaseni?pokracovat=${encodeURIComponent(cil)}`);
    await page.getByRole("button", { name: "Vyzkoušet jako člen týmu" }).click();
    await expect(page).toHaveURL((adresa) => adresa.pathname + adresa.search === cil);
    const obsah = page.getByRole("main");
    await expect(obsah.getByText(cislo).first()).toBeVisible();
    await expect(obsah.getByText("Návštěvník Z Landing Page").first()).toBeVisible();

    // Krok „Objednávka z Landing Page“ (a s ním Objednávky) je prošlý.
    const pruvodce = page.getByRole("region", { name: "Co si tu vyzkoušet" });
    await expect(pruvodce.getByText("Prošli jste 2 z 6")).toBeVisible();
  });

  test("z přihlašovacích stránek vede odkaz zpět na Landing Page", async ({ page }) => {
    // Adresa je `LANDING_PAGE_ADRESA` služby `e2e` v `compose.yaml`.
    await page.goto("/prihlaseni");
    await expect(page.getByRole("link", { name: "Zpět na Landing Page" })).toHaveAttribute(
      "href",
      "https://landing.example/",
    );
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("link", { name: "Back to the landing page" })).toHaveAttribute(
      "href",
      "https://landing.example/en/",
    );

    await page.goto("/ucet/prihlaseni");
    await expect(page.getByRole("link", { name: "Back to the landing page" })).toBeVisible();
    await page.getByRole("button", { name: "Česky" }).click();
    await expect(page.getByRole("link", { name: "Zpět na Landing Page" })).toHaveAttribute(
      "href",
      "https://landing.example/",
    );
  });

  test("ukázka nemá prázdné obrazovky a Eva je aktivní klientka", async ({ page }) => {
    await jakoClenTymu(page);
    // Bez vzorových záznamů by zájemce viděl jen „Zatím žádný…“.
    await page.goto("/produkty/slevove-kody");
    await expect(page.getByText("PODZIM500").first()).toBeVisible();
    await page.goto("/produkty/doporucitele");
    await expect(page.getByText("Podcast Investiční ráno").first()).toBeVisible();
    await page.goto("/nastaveni/pole");
    await expect(page.getByText("Zkušenost s investováním").first()).toBeVisible();
    await page.goto("/pravidla");
    await expect(page.getByText("VIP klient přestal chodit").first()).toBeVisible();

    // Čísla členství za 30 dní nejsou nuly: 2 prodloužili, 1 odešel, 2 noví.
    await page.goto("/dashboard");
    const udaj = (titulek: string) =>
      page
        .locator("div")
        .filter({ has: page.getByRole("term").filter({ hasText: titulek }) })
        .last();
    await expect(udaj("Míra prodloužení").getByRole("definition").first()).toHaveText("67 %");
    await expect(udaj("Odešli").getByRole("definition").first()).toHaveText("1");
    await expect(udaj("Noví členové").getByRole("definition").first()).toHaveText("2");

    await page.goto("/klienti");
    await page.getByRole("link", { name: "Eva Malá" }).first().click();
    await expect(page.getByText("9 z posledních 12")).toBeVisible();
  });

  test("Eva není v pořadí bodů sama", async ({ page }) => {
    await page.goto("/ucet/prihlaseni");
    await page.getByRole("button", { name: "Vyzkoušet jako klient" }).click();
    await expect(page.getByRole("heading", { name: "Dobrý den, Eva Malá" })).toBeVisible();
    await expect(page.getByText(/pořadí 2\. z 4/)).toBeVisible();
  });

  test("faktury vystavila vymyšlená firma", async ({ page }) => {
    await jakoClenTymu(page);
    await page.goto("/nastaveni/firma");
    await expect(page.getByLabel("IČO")).toHaveValue("00000000");
  });
});

test.describe("Ukázka — klient", () => {
  test(
    "přihlásí se jedním klikem a vidí kurz a členství",
    { tag: "@telefon" },
    async ({ page }) => {
      await page.goto("/ucet/prihlaseni");
      await bezVodorovnehoPosuvu(page);
      await page.getByRole("button", { name: "Vyzkoušet jako klient" }).click();

      await expect(page.getByRole("heading", { name: "Dobrý den, Eva Malá" })).toBeVisible();
      await expect(page.getByText(PRUH)).toBeVisible();
      await expect(page.getByText("Základy investování").first()).toBeVisible();
      await expect(page.getByText("BSM - Roční členství").first()).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // „Pokračovat“ vede na lekci s kvízem — krok průvodce „Kurz a kvíz“.
      // Průvodce se při první návštěvě rozbalí a na telefonu by ho zakryl.
      await page.getByRole("button", { name: "Sbalit průvodce" }).click();
      await page
        .getByRole("region", { name: "Pokračovat v kurzu" })
        .getByRole("link", { name: "Pokračovat" })
        .click();
      await expect(page.getByText("Kvíz k lekci")).toBeVisible();
    },
  );

  test(
    "anglický vstup: pruh a průvodce anglicky, přepnout jde i zpět",
    { tag: "@telefon" },
    async ({ page }) => {
      await page.goto("/ucet/prihlaseni");
      await page.getByRole("button", { name: "English" }).click();
      await page.getByRole("button", { name: "Try as a client" }).click();

      await expect(page.getByText(/Demo: the data is made up/)).toBeVisible();
      const pruvodce = page.getByRole("region", { name: "What to try here" });
      await expect(pruvodce.getByRole("link", { name: "Course and quiz" })).toBeVisible();
      await expect(pruvodce.getByText("The app is in Czech.", { exact: false })).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      await pruvodce.getByRole("button", { name: "Česky" }).click();
      await expect(page.getByRole("region", { name: "Co si tu vyzkoušet" })).toBeVisible();
      await expect(page.getByText(PRUH)).toBeVisible();
    },
  );

  test("platba kartou je vypnutá i s klíči GoPay na serveru", async ({ page }) => {
    // Testovací kontejner má klíče k napodobenině GoPay (compose.yaml) —
    // bez zábrany v ukázce by se tlačítko ukázalo (23. 10. 2026).
    await page.goto("/ucet/prihlaseni");
    await page.getByRole("button", { name: "Vyzkoušet jako klient" }).click();
    await expect(page.getByRole("heading", { name: "Dobrý den, Eva Malá" })).toBeVisible();

    // Eva má nezaplacenou objednávku — převodem zaplatit jde, kartou ne.
    await expect(page.getByRole("link", { name: "Platba převodem" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Zaplatit objednávku/ })).toHaveCount(0);
  });

  test(
    "průvodce vede na stránky klientské části",
    { tag: "@telefon" },
    async ({ page }, testInfo) => {
      await page.goto("/ucet/prihlaseni");
      await page.getByRole("button", { name: "Vyzkoušet jako klient" }).click();
      const pruvodce = page.getByRole("region", { name: "Co si tu vyzkoušet" });
      await expect(pruvodce.getByText("Prošli jste 1 z 5")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Odkazy v průvodci, ne `goto()` — tak, jak je projde návštěvník.
      // Na telefonu se panel po kliknutí na krok sbalí, ať nezakrývá stránku.
      const naTelefonu = testInfo.project.name !== "desktop";
      for (const [i, krok] of KROKY_PRUVODCE.klient.slice(1).entries()) {
        if (naTelefonu && i > 0)
          await page.getByRole("button", { name: /Co si vyzkoušet/ }).click();
        await pruvodce.getByRole("link", { name: krok.nazev }).click();
        if (naTelefonu) await expect(pruvodce).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`${krok.href}$`));
        await expect(page.getByText("Tady nic není")).toHaveCount(0);
        const pocet = naTelefonu
          ? page.getByRole("button", { name: `Co si vyzkoušet ${i + 2}/5` })
          : pruvodce.getByText(`Prošli jste ${i + 2} z 5`);
        await expect(pocet).toBeVisible();
      }
    },
  );

  test(
    "na telefonu se průvodce sbalí i po přechodu spodní lištou",
    { tag: "@telefon" },
    async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "desktop", "spodní lišta je jen na telefonu");
      await page.goto("/ucet/prihlaseni");
      await page.getByRole("button", { name: "Vyzkoušet jako klient" }).click();
      const pruvodce = page.getByRole("region", { name: "Co si tu vyzkoušet" });
      await expect(pruvodce).toBeVisible();

      // Jinak by otevřený panel zakryl stránku, na kterou návštěvník přešel.
      await page.getByRole("link", { name: "Kurzy", exact: true }).last().click();
      await expect(page).toHaveURL(/\/ucet\/kurzy$/);
      await expect(pruvodce).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Co si vyzkoušet/ })).toBeVisible();
    },
  );
});
