import { expect, test } from "@playwright/test";

import { bezVodorovnehoPosuvu, nahodnaAdresa } from "./pomocne";

/**
 * Přepínač Česky / English na přihlašovacích stránkách (Jakub, 23. 10. 2026,
 * `src/lib/jazyk.ts`). Anglicky je jen vstup — přihlášení, pruh a průvodce
 * ukázky; zbytek aplikace zůstává česky.
 */

test.describe("jazyk přihlašovacích stránek", () => {
  test(
    "přihlášení týmu jde přepnout do angličtiny a zpět",
    { tag: "@telefon" },
    async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
      await page.goto("/prihlaseni");
      await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();

      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Access for the Beat Stock Market team only/)).toBeVisible();
      await expect(page).toHaveTitle(/^Sign in/);
      await bezVodorovnehoPosuvu(page);

      // Volba přežije obnovení stránky (cookie) a chyby jsou taky anglicky.
      await page.reload();
      await page.getByLabel("Email").fill("nikdo@beatstockmarket.test");
      await page.getByLabel("Password").fill("spatne-heslo-1234");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText("Incorrect email or password.")).toBeVisible();

      await page.getByRole("button", { name: "Česky" }).click();
      await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeVisible();
    },
  );

  test("přihlášení klienta jde přepnout do angličtiny", { tag: "@telefon" }, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
    await page.goto("/ucet/prihlaseni");
    await page.getByRole("button", { name: "English" }).click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/We set up your client account/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy policy (CZ)" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot password" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });

  test("nesmyslná hodnota v cookie znamená češtinu", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "jazyk", value: "de", url: baseURL! }]);
    await page.goto("/prihlaseni");
    await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();
  });

  test("mimo ukázku odkaz zpět na Landing Page není", async ({ page }) => {
    // `LANDING_PAGE_ADRESA` je v testech vyplněná — rozhoduje `UKAZKA=1` (krok 1C).
    await page.goto("/prihlaseni");
    await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zpět na Landing Page" })).toHaveCount(0);
  });
});
