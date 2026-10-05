import { expect, test, type Page } from "@playwright/test";

import {
  cekejNaUspech,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Úkoly — od 23. 9. 2026 na Dashboardu v Mém dni (Jakub).
 *
 * Záložka Úkoly na kartě klienta zmizela, takže se úkoly zakládají,
 * upravují, odškrtávají i mažou v bloku Moje úkoly. Klient se vybírá
 * v okně.
 *
 * **Oprávnění, která se tu hlídají:**
 * - zakládá každý, ale jen sobě; administrátor i kolegovi (pole „Komu"),
 * - mění a maže majitel a administrátor.
 */

/** Blok Moje úkoly na Dashboardu. */
function mojeUkoly(page: Page) {
  return page.locator("[data-slot='card']").filter({ hasText: "Moje úkoly" });
}

/** Na Dashboardu založí úkol u daného klienta. */
async function zalozUkol(page: Page, klient: string, nazev: string) {
  /*
   * Ne holé `goto()`: formulář klienta po uložení obnovuje stránku
   * a přechod jinam se s tím srazí (CLAUDE.md).
   */
  await otevriAzUvidis(page, "/dashboard", page.getByRole("button", { name: "Nový úkol" }));
  await page.getByRole("button", { name: "Nový úkol" }).click();
  const okno = page.getByRole("dialog", { name: "Nový úkol" });
  await okno.getByRole("combobox", { name: "Klient" }).click();
  await page.getByRole("option", { name: klient }).click();
  await okno.getByLabel("Co je potřeba").fill(nazev);
  await okno.getByRole("button", { name: "Založit úkol" }).click();
  await cekejNaUspech(page, "je založený");
}

test.describe("úkoly na Dashboardu", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("založit, upravit, odškrtnout", async ({ page }) => {
    const klient = `Ukol Klient ${pripona()}`;
    await zalozKlientaFormularem(page, klient);
    const nazev = `Zavolat ${pripona()}`;

    await zalozUkol(page, klient, nazev);

    const radek = mojeUkoly(page).locator("li").filter({ hasText: nazev });
    await expect(radek).toBeVisible();
    await expect(radek).toContainText(klient);

    // --- úprava ---
    await radek.getByRole("button", { name: `Upravit úkol ${nazev}` }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit úkol" });
    await uprava.getByLabel("Co je potřeba").fill(`${nazev} znovu`);
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Úkol je upravený.");
    const upraveny = mojeUkoly(page)
      .locator("li")
      .filter({ hasText: `${nazev} znovu` });
    await expect(upraveny).toBeVisible();

    // --- odškrtnutí: hotový úkol z Mého dne zmizí ---
    await upraveny.getByRole("checkbox").check();
    await expect(mojeUkoly(page).getByText(`${nazev} znovu`)).toHaveCount(0);
  });

  test("smazat s potvrzením", async ({ page }) => {
    const klient = `Ukol Mazani ${pripona()}`;
    await zalozKlientaFormularem(page, klient);
    const nazev = `Smazat ${pripona()}`;

    await zalozUkol(page, klient, nazev);

    const radek = mojeUkoly(page).locator("li").filter({ hasText: nazev });
    await radek.getByRole("button", { name: `Smazat úkol ${nazev}` }).click();
    await expect(page.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await page.getByRole("button", { name: "Smazat", exact: true }).click();
    await cekejNaUspech(page, "je smazaný");

    await expect(mojeUkoly(page).getByText(nazev)).toHaveCount(0);
  });

  test("uživatel nemá pole Komu — zadává jen sobě", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Nový úkol" }).click();

    const okno = page.getByRole("dialog", { name: "Nový úkol" });
    await expect(okno.getByLabel("Co je potřeba")).toBeVisible();
    await expect(okno.getByRole("combobox", { name: "Klient" })).toBeVisible();
    await expect(okno.getByLabel("Komu")).toHaveCount(0);
  });

  test("bez vybraného klienta se úkol nezaloží", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Nový úkol" }).click();

    const okno = page.getByRole("dialog", { name: "Nový úkol" });
    await okno.getByLabel("Co je potřeba").fill(`Bez klienta ${pripona()}`);
    await okno.getByRole("button", { name: "Založit úkol" }).click();
    await expect(okno.getByText("Vyber klienta.")).toBeVisible();
  });
});

test.describe("úkoly očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor vybírá, komu úkol patří", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Nový úkol" }).click();

    // Pole „Komu" se nabízí jen administrátorovi.
    await expect(page.getByRole("dialog", { name: "Nový úkol" }).getByLabel("Komu")).toBeVisible();
  });
});
