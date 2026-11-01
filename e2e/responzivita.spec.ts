import { expect, test } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, jeMobil, menu, stavPrihlaseni } from "./pomocne";

/**
 * Aplikace na desktopu i na telefonu. Běží ve všech projektech
 * (desktop, Android, iPhone) — viz playwright.config.ts.
 */

const STRANKY = [
  "/dashboard",
  "/klienti",
  "/klienti/duplicity",
  "/objednavky",
  "/brokeri",
  "/brokeri/trading212",
  "/produkty",
  "/profil",
  "/sprava/uzivatele",
  "/smazane",
  "/smartemailing",
  "/nastaveni",
  "/nastaveni/prodlouzeni",
];

test.describe("rozvržení", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  for (const adresa of STRANKY) {
    test(`${adresa} nepřečnívá z okna`, async ({ page }) => {
      await page.goto(adresa);
      await expect(page.locator("main, [data-slot='sidebar-inset']").first()).toBeVisible();
      await bezVodorovnehoPosuvu(page);
    });
  }

  // Karta klienta má pět záložek — na telefonu kvůli nim přečnívala
  // (nalezeno testy 17. 9. 2026).
  test("karta klienta nepřečnívá z okna", async ({ page }) => {
    const [klient] = await dotaz<{ id: string }>(`SELECT "id" FROM "clients" WHERE "name" = $1`, [
      "Jan Novák",
    ]);
    expect(klient, "ukázkový klient ze seedu").toBeDefined();

    await page.goto(`/klienti/${klient.id}`);
    await expect(page.getByRole("heading", { name: "Jan Novák" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // Okno Poznámky (od 23. 9. 2026) se na úzký displej vejde.
    await page.getByRole("button", { name: /Poznámky/ }).click();
    await expect(page.getByRole("dialog", { name: "Poznámky" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });

  test("přihlašovací stránka nepřečnívá z okna", async ({ browser }) => {
    const kontext = await browser.newContext({ storageState: undefined });
    const page = await kontext.newPage();
    await page.goto("/prihlaseni");
    await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeInViewport();
    await bezVodorovnehoPosuvu(page);
    await kontext.close();
  });

  test("menu vede na jinou sekci", async ({ page }) => {
    await page.goto("/dashboard");
    const panel = await menu(page);
    await panel.getByRole("link", { name: "Produkty", exact: true }).click();

    await expect(page).toHaveURL(/\/produkty$/);
    // Na telefonu se vysouvací panel po výběru sám zavře.
    if (jeMobil(page)) {
      await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toBeHidden();
    }
  });

  test("na telefonu je menu schované, na desktopu vidět", async ({ page }) => {
    await page.goto("/dashboard");
    const odkaz = page.getByRole("link", { name: "Klienti", exact: true });

    if (jeMobil(page)) {
      await expect(odkaz).toBeHidden();
      await page.getByRole("button", { name: "Zobrazit nebo skrýt menu" }).click();
      await expect(odkaz).toBeVisible();
    } else {
      await expect(odkaz).toBeVisible();
    }
  });

  /*
   * Kontrola všech obrazovek ve třech šířkách (26. 9. 2026). Nic
   * nepřečnívalo, ale našlo se tohle — testy hlídají, ať se to nevrátí.
   */
  test("název obrazovky v horní liště není useknutý", async ({ page }) => {
    // Nejdelší názvy v menu. Na telefonu z nich zbylo „Sm…" a „Nas…".
    for (const [adresa, nazev] of [
      ["/smartemailing", "SmartEmailing"],
      ["/nastaveni", "Nastavení"],
      ["/profil", "Můj profil"],
    ] as const) {
      await page.goto(adresa);
      const nadpis = page.locator("header").getByRole("heading", { level: 1, name: nazev });
      await expect(nadpis).toBeVisible();
      const useknuty = await nadpis.evaluate((prvek) => prvek.scrollWidth > prvek.clientWidth);
      expect(useknuty, `${nazev} se do lišty vejde celý`).toBe(false);
    }
  });

  test("zdroje klientů: tlačítka se nepřekrývají", async ({ page }) => {
    await page.goto("/nastaveni/zdroje");
    const radek = page.getByRole("button", { name: "Uložit", exact: true }).first();
    await expect(radek).toBeVisible();

    const ulozit = await radek.boundingBox();
    const skryt = await page
      .getByRole("button", { name: "Skrýt", exact: true })
      .first()
      .boundingBox();
    expect(ulozit).not.toBeNull();
    expect(skryt).not.toBeNull();
    const prekryv =
      Math.min(ulozit!.x + ulozit!.width, skryt!.x + skryt!.width) >
        Math.max(ulozit!.x, skryt!.x) &&
      Math.min(ulozit!.y + ulozit!.height, skryt!.y + skryt!.height) >
        Math.max(ulozit!.y, skryt!.y);
    expect(prekryv, "Uložit a Skrýt jsou přes sebe").toBe(false);
    await bezVodorovnehoPosuvu(page);
  });

  test("široká tabulka ukáže stín tam, kam jde posunout", async ({ page }) => {
    // Na telefonu tabulka Produktů pokračuje doprava a nebylo to poznat
    // (26. 9. 2026). Na počítači se vejde celá a stín nemá být nikde.
    await page.goto("/produkty");
    const posuv = page.locator('[data-slot="table-container"]').first();
    const vpravo = page.locator('[data-slot="table-stin-vpravo"]').first();
    const vlevo = page.locator('[data-slot="table-stin-vlevo"]').first();
    await expect(posuv).toBeVisible();

    const pokracuje = await posuv.evaluate((prvek) => prvek.scrollWidth > prvek.clientWidth + 1);
    await expect(vlevo).toHaveCSS("opacity", "0");

    if (!pokracuje) {
      await expect(vpravo).toHaveCSS("opacity", "0");
      return;
    }

    await expect(vpravo).toHaveCSS("opacity", "1");
    await posuv.evaluate((prvek) => prvek.scrollTo({ left: prvek.scrollWidth }));
    await expect(vpravo).toHaveCSS("opacity", "0");
    await expect(vlevo).toHaveCSS("opacity", "1");
  });

  test("objednávky na tabletu: hledací pole má kam psát", async ({ page }) => {
    // Na šířce tabletu se pole smrsklo na „Čí".
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/objednavky");
    const pole = page.getByPlaceholder("Číslo objednávky, klient nebo produkt");
    await expect(pole).toBeVisible();
    expect((await pole.boundingBox())!.width).toBeGreaterThanOrEqual(200);
  });

  test("formulář nového klienta se vejde na obrazovku", async ({ page }) => {
    await page.goto("/klienti");
    await page.getByRole("button", { name: "Nový klient" }).click();

    const dialog = page.getByRole("dialog", { name: "Nový klient" });
    await expect(dialog).toBeVisible();

    const okno = page.viewportSize();
    const ramec = await dialog.boundingBox();
    expect(okno).not.toBeNull();
    expect(ramec).not.toBeNull();
    expect(ramec!.x).toBeGreaterThanOrEqual(0);
    expect(ramec!.x + ramec!.width).toBeLessThanOrEqual(okno!.width);

    // Tlačítko na konci formuláře jde odrolovat a kliknout.
    const odeslat = dialog.getByRole("button", { name: "Založit klienta" });
    await odeslat.scrollIntoViewIfNeeded();
    await expect(odeslat).toBeInViewport();
  });
});
