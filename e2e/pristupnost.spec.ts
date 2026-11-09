import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  lekceKurzu,
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozKurz,
  zalozProdukt,
} from "./pomocne-klient";
import { dotaz, jeMobil, pripona, stavPrihlaseni } from "./pomocne";

/**
 * Přístupnost (Jakub, 24. 10. 2026): nástroj axe na každé hlavní
 * obrazovce ve světlém i tmavém vzhledu — kontrast, popisky, nadpisy,
 * oblasti stránky (WCAG 2.2 AA a doporučené postupy). Klientská část
 * prošla 23. 10., týmová 24. 10. (našlo se menu mimo oblasti stránky
 * a anglické názvy menu pro čtečku obrazovky).
 *
 * Nová obrazovka = nový řádek v `OBRAZOVKY_TYMU` nebo `OBRAZOVKY_KLIENTA`.
 */

const OBRAZOVKY_TYMU = [
  "/dashboard",
  "/klienti",
  "/klienti/duplicity",
  "/objednavky",
  "/brokeri",
  "/brokeri/trading212",
  "/produkty",
  "/vzdelavani",
  "/konzultace",
  "/pravidla",
  "/asistent",
  "/sprava/uzivatele",
  "/smazane",
  "/smartemailing",
  "/nastaveni",
  // Šablony e-mailů z karty klienta (5D, 5. 11. 2026).
  "/nastaveni/sablony",
  "/profil",
];

const VEREJNE = [
  "/prihlaseni",
  "/zapomenute-heslo",
  "/ucet/prihlaseni",
  "/ucet/zapomenute-heslo",
  "/ucet/zasady",
  "/ucet/podminky",
  "/ucet/obchodni-podminky",
];

const OBRAZOVKY_KLIENTA = [
  "/ucet",
  "/ucet/kurzy",
  "/ucet/clenska-sekce",
  "/ucet/webinare",
  "/ucet/koupit",
  "/ucet/konzultace",
  "/ucet/doporuc",
  "/ucet/zpravy",
  "/ucet/profil",
];

/** Projde stránku ve světlém i tmavém vzhledu; vrací seznam chyb. */
async function chybyPristupnosti(page: Page, adresa: string): Promise<string[]> {
  const chyby: string[] = [];
  for (const vzhled of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: vzhled });
    await page.goto(adresa);
    await expect(page.locator("h1").first()).toBeVisible();
    const vysledek = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    for (const v of vysledek.violations) {
      const kde = v.nodes.map((n) => n.target.join(" ")).slice(0, 3);
      chyby.push(`${adresa} (${vzhled}) ${v.id}: ${v.help} → ${kde.join(", ")}`);
    }
  }
  return chyby;
}

test.describe("tým", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  for (const adresa of OBRAZOVKY_TYMU) {
    test(`${adresa} projde kontrolou přístupnosti`, async ({ page }) => {
      expect(await chybyPristupnosti(page, adresa)).toEqual([]);
    });
  }

  test("karta klienta a detail objednávky projdou kontrolou přístupnosti", async ({ page }) => {
    const [klient] = await dotaz<{ id: string }>(`SELECT "id" FROM "clients" WHERE "name" = $1`, [
      "Jan Novák",
    ]);
    const [objednavka] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "orders" WHERE "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`,
    );
    expect(klient, "ukázkový klient ze seedu").toBeDefined();
    expect(objednavka, "ukázková objednávka ze seedu").toBeDefined();
    expect([
      ...(await chybyPristupnosti(page, `/klienti/${klient.id}`)),
      ...(await chybyPristupnosti(page, `/objednavky/${objednavka.id}`)),
    ]).toEqual([]);
  });

  test("z klávesnice jde přeskočit menu rovnou na obsah", async ({ page }) => {
    await page.goto("/klienti");
    await page.keyboard.press("Tab");
    const odkaz = page.getByRole("link", { name: "Přeskočit na obsah" });
    await expect(odkaz).toBeFocused();
    await expect(odkaz).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#obsah")).toBeFocused();
  });

  test("menu je pro čtečku obrazovky „Hlavní menu“", { tag: "@telefon" }, async ({ page }) => {
    await page.goto("/dashboard");
    if (jeMobil(page)) {
      await page.getByRole("button", { name: "Zobrazit nebo skrýt menu" }).click();
      const okno = page.getByRole("dialog", { name: "Hlavní menu" });
      await expect(okno.getByRole("link", { name: "Klienti", exact: true })).toBeVisible();
      const vysledek = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(vysledek.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    } else {
      const menu = page.getByRole("navigation", { name: "Hlavní menu" });
      await expect(menu.getByRole("link", { name: "Klienti", exact: true })).toBeVisible();
    }
  });
});

/**
 * Otevře postupně každé okno na stránce (tlačítka s `aria-haspopup=dialog`
 * — tak je označí Radix) a zkontroluje ho; vrací seznam chyb.
 */
async function chybyVOknech(page: Page, adresa: string): Promise<string[]> {
  const chyby: string[] = [];
  await page.goto(adresa);
  await expect(page.locator("h1").first()).toBeVisible();
  const tlacitka = page.locator('main [aria-haspopup="dialog"]:visible');
  const pocet = await tlacitka.count();
  for (let i = 0; i < pocet; i++) {
    const tlacitko = tlacitka.nth(i);
    if (await tlacitko.isDisabled()) continue;
    const nazev = (await tlacitko.getAttribute("aria-label")) ?? (await tlacitko.innerText());
    await tlacitko.click();
    const okno = page.locator('[role="dialog"], [role="alertdialog"]').last();
    await expect(okno, `okno z tlačítka „${nazev}“`).toBeVisible();
    // Uprostřed náběhu je okno průhledné a kontrast by vyšel špatně.
    await okno.evaluate((prvek) =>
      Promise.all(prvek.getAnimations({ subtree: true }).map((animace) => animace.finished)),
    );
    const vysledek = await new AxeBuilder({ page })
      .include('[role="dialog"], [role="alertdialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    for (const v of vysledek.violations) {
      const kde = v.nodes.map((n) => n.target.join(" ")).slice(0, 3);
      chyby.push(`${adresa} okno „${nazev.trim()}“ ${v.id}: ${v.help} → ${kde.join(", ")}`);
    }
    await page.keyboard.press("Escape");
    await expect(okno).toBeHidden();
  }
  return chyby;
}

test.describe("okna", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("okna týmu projdou kontrolou přístupnosti", async ({ page }) => {
    test.setTimeout(300_000);
    const [klient] = await dotaz<{ id: string }>(`SELECT "id" FROM "clients" WHERE "name" = $1`, [
      "Jan Novák",
    ]);
    const [objednavka] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "orders" WHERE "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`,
    );
    // Bez štítku, který klient nemá, se nabídka „Přidat štítek“ nezobrazí
    // a test by ji přeskočil (samotný soubor bez ostatních testů to tak dělal).
    await dotaz(
      `INSERT INTO "client_tags" ("id", "name", "color", "updatedAt")
       VALUES ($1, $2, 'ZNACKA'::"TagColor", now())`,
      [`e2estitek${pripona()}${pripona()}`, `Přístupnost ${pripona()}`],
    );
    const chyby: string[] = [];
    for (const adresa of [
      "/klienti",
      `/klienti/${klient.id}`,
      `/objednavky/${objednavka.id}`,
      "/produkty",
      "/brokeri",
      "/sprava/uzivatele",
      "/profil",
    ]) {
      chyby.push(...(await chybyVOknech(page, adresa)));
    }
    expect(chyby).toEqual([]);
  });
});

test.describe("bez přihlášení", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const adresa of VEREJNE) {
    test(`${adresa} projde kontrolou přístupnosti`, { tag: "@telefon" }, async ({ page }) => {
      expect(await chybyPristupnosti(page, adresa)).toEqual([]);
    });
  }

  // Minikurz zdarma (Platforma B, 5. 11. 2026) — veřejná ukázka kurzu.
  test("/ucet/kurz-zdarma projde kontrolou přístupnosti", { tag: "@telefon" }, async ({ page }) => {
    const produkt = await zalozProdukt(
      `E2E Přístupnost ukázky ${pripona()}`,
      "KURZ",
      "https://example.com/kurz",
    );
    const kurzId = await zalozKurz(produkt, `Ukázka přístupnost ${pripona()}`, [
      "Placená s videem",
      "Zdarma",
    ]);
    // Zdarma je druhá lekce, bez videa — přehrávač YouTube má vlastní chyby
    // ARIA, které opravit nejde (lekce s videem tu nekontrolujeme ani jinde).
    const [, zdarma] = await lekceKurzu(kurzId);
    await dotaz(`UPDATE "course_lessons" SET "freePreview" = true WHERE "id" = $1`, [zdarma]);
    expect(await chybyPristupnosti(page, `/ucet/kurz-zdarma/${kurzId}`)).toEqual([]);
  });
});

test("klientská část projde kontrolou přístupnosti", { tag: "@telefon" }, async ({ browser }) => {
  // Prochází všechny obrazovky klienta i okna; na iPhonu to trvá přes dvě minuty.
  test.setTimeout(300_000);
  const klient = await zalozKlientaSUctem("Přístupnost Klient");
  const page = await prohlizecKlienta(browser);
  await prihlasKlienta(page, klient.email, klient.heslo);

  const chyby: string[] = [];
  for (const adresa of OBRAZOVKY_KLIENTA) {
    chyby.push(...(await chybyPristupnosti(page, adresa)));
  }
  for (const adresa of ["/ucet/koupit", "/ucet/profil"]) {
    chyby.push(...(await chybyVOknech(page, adresa)));
  }
  expect(chyby).toEqual([]);
  await page.context().close();
});
