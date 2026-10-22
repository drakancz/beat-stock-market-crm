import { expect, test, type Page } from "@playwright/test";

import { KROKY_PRUVODCE } from "../src/lib/pruvodce-ukazkou";
import { UKAZKOVY_TYM, VYPNUTO_V_UKAZCE } from "../src/lib/ukazka";
import { bezVodorovnehoPosuvu, nahodnaAdresa } from "../e2e/pomocne";

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
      await expect(pruvodce.getByText("Prošli jste 1 z 5")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Karta klienta (druhý krok) se odškrtne až otevřením karty, ne
      // seznamem. Na počet se čeká po každé stránce — jinak by `goto()`
      // odešel dřív, než se průvodce na pomalejším telefonu načte.
      const ocekavanyPocet = [1, 1, 2, 3, 4];
      for (const [i, krok] of KROKY_PRUVODCE.tym.entries()) {
        const odpoved = await page.goto(krok.href);
        expect(odpoved?.status(), `${krok.href} má existovat`).toBe(200);
        await expect(pruvodce.getByText(`Prošli jste ${ocekavanyPocet[i]} z 5`)).toBeVisible();
      }

      await pruvodce.getByRole("link", { name: "Karta klienta" }).click();
      await page.getByRole("main").getByRole("link", { name: "Eva Malá" }).first().click();
      await expect(page.getByRole("heading", { name: "Eva Malá" })).toBeVisible();
      // Na telefonu se panel po kliknutí na krok sbalí, ať nezakrývá stránku.
      const tlacitko = page.getByRole("button", { name: /Co si vyzkoušet/ });
      if (testInfo.project.name !== "desktop") await tlacitko.click();
      await expect(pruvodce.getByText("Prošli jste 5 z 5")).toBeVisible();

      // Sbalený zůstane i po načtení jiné stránky.
      await pruvodce.getByRole("button", { name: "Sbalit průvodce" }).click();
      await page.goto("/klienti");
      await expect(pruvodce).toHaveCount(0);
      await page.getByRole("button", { name: /Co si vyzkoušet/ }).click();
      await pruvodce.getByRole("button", { name: "Začít znovu" }).click();
      await expect(pruvodce.getByText("Prošli jste 0 z 5")).toBeVisible();
    },
  );

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
      await expect(page.getByText("Členství Klub BSM — rok").first()).toBeVisible();
      await bezVodorovnehoPosuvu(page);
    },
  );

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
});
