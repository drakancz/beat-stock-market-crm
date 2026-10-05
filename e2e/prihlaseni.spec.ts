import { expect, test } from "@playwright/test";

import {
  NAZEV_ROLE,
  upravUzivatele,
  menu,
  nahodnaAdresa,
  prihlas,
  zalozUzivatele,
  type RoleTestu,
} from "./pomocne";

/**
 * Přihlášení a odhlášení pro všechny tři role.
 *
 * Každý test si zakládá vlastní účet — sdílená přihlášení z přípravy se
 * tu nepoužívají, protože odhlášení a odebrání přístupu by je rozbilo.
 */

const ROLE: RoleTestu[] = ["admin", "uzivatel"];

test.describe("přihlášení", () => {
  for (const role of ROLE) {
    test(`${NAZEV_ROLE[role]} se přihlásí a odhlásí`, async ({ page }) => {
      const ucet = await zalozUzivatele(role);

      await prihlas(page, ucet.email, ucet.heslo);
      await expect(page).toHaveURL(/\/dashboard/);

      // Jméno a role dole v menu.
      const panel = await menu(page);
      const uzivatel = panel.getByRole("button", { name: new RegExp(ucet.name) });
      await expect(uzivatel).toContainText(NAZEV_ROLE[role]);

      await uzivatel.click();
      await page.getByRole("menuitem", { name: "Odhlásit se" }).click();
      await expect(page).toHaveURL(/\/prihlaseni/);

      // Po odhlášení se zpátky nedostane.
      await page.goto("/klienti");
      await expect(page).toHaveURL(/\/prihlaseni/);
    });
  }

  test("špatné heslo neprojde a hláška neprozradí, jestli účet existuje", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");

    await prihlas(page, ucet.email, `${ucet.heslo}x`);
    await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    await expect(page).toHaveURL(/\/prihlaseni/);

    await prihlas(page, "nikdo-takovy@beatstockmarket.test", ucet.heslo);
    await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
  });

  test("po přihlášení pokračuje na stránku, kam původně šel", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");

    await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
    await page.goto("/brokeri");
    await expect(page).toHaveURL(/\/prihlaseni/);

    await page.getByLabel("E-mail").fill(ucet.email);
    await page.getByLabel("Heslo", { exact: true }).fill(ucet.heslo);
    await page.getByRole("button", { name: "Přihlásit se" }).click();

    await expect(page).toHaveURL(/\/brokeri$/);
  });

  test("po pěti špatných pokusech přihlášení zablokuje i správné heslo", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");
    // Všechny pokusy z jedné adresy — jinak by se omezení neprojevilo.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
    await page.goto("/prihlaseni");

    for (let pokus = 0; pokus < 5; pokus++) {
      await page.getByLabel("E-mail").fill(ucet.email);
      await page.getByLabel("Heslo", { exact: true }).fill(`spatne-${pokus}`);
      await page.getByRole("button", { name: "Přihlásit se" }).click();
      await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    }

    await page.getByLabel("Heslo", { exact: true }).fill(ucet.heslo);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByText(/Příliš mnoho neúspěšných pokusů/)).toBeVisible();
    await expect(page).toHaveURL(/\/prihlaseni/);
  });

  test("účet s odebraným přístupem se nepřihlásí", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");
    await upravUzivatele(ucet.id, { active: false });

    await prihlas(page, ucet.email, ucet.heslo);
    await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
  });

  test("smazaný účet se nepřihlásí", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");
    await upravUzivatele(ucet.id, { deletedAt: new Date() });

    await prihlas(page, ucet.email, ucet.heslo);
    await expect(page.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
  });

  test("odebrání přístupu vyhodí i už přihlášeného", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");

    await prihlas(page, ucet.email, ucet.heslo);
    await expect(page).toHaveURL(/\/dashboard/);

    // Totéž, co udělá administrátor tlačítkem „Odebrat přístup".
    await upravUzivatele(ucet.id, { active: false, tokensValidFrom: new Date() });

    await page.goto("/klienti");
    await expect(page).toHaveURL(/\/prihlaseni/);
  });
});
