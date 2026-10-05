import { expect, test, type Page } from "@playwright/test";

import { cekejNaUspech, otevriAzUvidis, pripona, stavPrihlaseni } from "./pomocne";

/**
 * Brokeři: seznam vidí každý přihlášený, měnit smí jen administrátor
 * (Jakub, 6. 9. 2026). Že obchodník a manažer tlačítko nemají, hlídá
 * `opravneni.spec.ts`.
 */

/** Otevře seznam brokerů vyhledaný podle názvu a vrátí řádek. */
async function najdiVSeznamu(page: Page, nazev: string) {
  const radek = page.getByRole("row").filter({ hasText: nazev });
  await otevriAzUvidis(page, `/brokeri?hledat=${encodeURIComponent(nazev)}`, radek);
  return radek;
}

test.describe("broker", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor přidá, upraví a smaže brokera", async ({ page }) => {
    const nazev = `Test Broker ${pripona()}`;
    const novyNazev = `${nazev} Plus`;

    await page.goto("/brokeri");
    await page.getByRole("button", { name: "Nový broker" }).click();
    const dialog = page.getByRole("dialog", { name: "Nový broker" });
    await dialog.getByLabel("Název").fill(nazev);
    await dialog.getByLabel("Web").fill("https://example.com");
    await dialog.getByRole("button", { name: "Přidat brokera" }).click();
    await cekejNaUspech(page, `Broker ${nazev} je v seznamu.`);

    const radek = await najdiVSeznamu(page, nazev);

    await radek.getByRole("button", { name: "Upravit" }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit brokera" });
    await uprava.getByLabel("Název").fill(novyNazev);
    await uprava.getByRole("button", { name: "Uložit změny" }).click();
    await expect(uprava).toBeHidden();

    const upraveny = await najdiVSeznamu(page, novyNazev);
    await upraveny.getByRole("button", { name: `Smazat ${novyNazev}` }).click();

    const potvrzeni = page.getByRole("dialog", { name: "Smazat brokera" });
    await expect(potvrzeni).toContainText(novyNazev);
    await expect(potvrzeni).toContainText("nelze vzít zpět");
    await potvrzeni.getByRole("button", { name: "Smazat", exact: true }).click();
    await expect(potvrzeni).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: novyNazev })).toHaveCount(0);
  });

  test("odkaz, který není https, se neuloží", async ({ page }) => {
    const nazev = `Test Http ${pripona()}`;

    await page.goto("/brokeri");
    await page.getByRole("button", { name: "Nový broker" }).click();
    const dialog = page.getByRole("dialog", { name: "Nový broker" });
    await dialog.getByLabel("Název").fill(nazev);
    await dialog.getByLabel("Web").fill("http://example.com");
    await dialog.getByRole("button", { name: "Přidat brokera" }).click();

    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`/brokeri?hledat=${encodeURIComponent(nazev)}`);
    await expect(page.getByRole("row").filter({ hasText: nazev })).toHaveCount(0);
  });
});
