import { expect, test, type Page } from "@playwright/test";

import { dotaz, menu, stavPrihlaseni, type RoleTestu } from "./pomocne";

/**
 * Oprávnění podle rolí (CLAUDE.md → Role a oprávnění).
 *
 * Od 22. 9. 2026 jsou role dvě a **nerozhodují o tom, co kdo vidí**:
 * klienti se nikomu nepřiřazují, takže všechny záznamy vidí každý
 * přihlášený.
 *
 * | Role          | Co smí                                            |
 * | ------------- | ------------------------------------------------- |
 * | uživatel      | vidí všechno, nespravuje systém                   |
 * | administrátor | navíc Správa, Nastavení, Smazané, SmartEmailing   |
 *
 * Nepovolaný dostane 404, ne „nemáte oprávnění".
 */

const MENU_PRO_VSECHNY = ["Dashboard", "Klienti", "Objednávky", "Produkty", "Konzultace"];

/**
 * Z menu schované (Jakub, 24. 9. 2026), ale stránky dál existují —
 * pro obě role.
 */
const SKRYTE_V_MENU = [{ polozka: "Brokeři", adresa: "/brokeri" }];

// Asistent AI jen pro administrátora (Jakub, 10. 10. 2026).
const MENU_JEN_ADMIN = ["Asistent AI", "Správa", "Smazané", "SmartEmailing", "Nastavení"];

const JEN_ADMIN = [
  "/sprava",
  "/sprava/uzivatele",
  "/smazane",
  "/smartemailing",
  "/smartemailing/chyby",
  "/smartemailing/nastaveni",
  "/nastaveni",
  "/nastaveni/aktivita",
  // Komu chodí úkoly na prodloužení členství (Jakub, 24. 9. 2026).
  "/nastaveni/prodlouzeni",
  // Odchozí webhooky (19. 10. 2026).
  "/nastaveni/webhooky",
  // Google Kalendář pro konzultace (20. 10. 2026).
  "/nastaveni/kalendar",
  "/asistent",
  // Doporučitelé a odměny (5A, 15. 10. 2026).
  "/produkty/doporucitele",
];

/** Ukázkový klient Petry Dvořákové ze seedu — cizí pro zkušební účty. */
const CIZI_KLIENT = "Jan Novák";

async function ocekavej404(page: Page, adresa: string) {
  const odpoved = await page.goto(adresa);
  expect(odpoved?.status(), `${adresa} má vrátit 404`).toBe(404);
  await expect(page.getByText("Tady nic není")).toBeVisible();
}

test.describe("uživatel: bez administrátorských sekcí", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("menu neukazuje administrátorské položky", async ({ page }) => {
    await page.goto("/dashboard");
    const panel = await menu(page);

    for (const polozka of MENU_PRO_VSECHNY) {
      await expect(panel.getByRole("link", { name: polozka, exact: true })).toBeVisible();
    }
    for (const polozka of MENU_JEN_ADMIN) {
      await expect(panel.getByRole("link", { name: polozka, exact: true })).toHaveCount(0);
    }
  });

  test("administrátorské adresy vrací 404", async ({ page }) => {
    for (const adresa of JEN_ADMIN) await ocekavej404(page, adresa);
  });

  // Klíče pro AI (MCP) si vytváří jen administrátor (Jakub, 27. 9. 2026).
  test("v Mém profilu nejsou klíče pro AI", async ({ page }) => {
    await page.goto("/profil");
    await expect(page.getByText("Dvoufázové ověření").first()).toBeVisible();
    await expect(page.getByText("Klíče pro AI (MCP)")).toHaveCount(0);
  });

  // Ceník mění a produkty maže jen administrátor (Jakub, 27. 9. 2026).
  test("ceník vidí, upravit ani smazat produkt nemůže", async ({ page }) => {
    await page.goto("/produkty");
    await expect(page.getByRole("heading", { name: "Produkty" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Upravit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Smazat" })).toHaveCount(0);
  });

  // Možné duplicity vidí každý, sloučit smí jen administrátor (Jakub, 27. 9. 2026).
  test("možné duplicity vidí, tlačítko Sloučit nemá", async ({ page }) => {
    const odpoved = await page.goto("/klienti/duplicity");
    expect(odpoved?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Možné duplicity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sloučit" })).toHaveCount(0);
  });

  test("nemůže přidat brokera", async ({ page }) => {
    await page.goto("/brokeri");
    await expect(page.getByRole("heading", { name: "Brokeři" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Nový broker" })).toHaveCount(0);
  });

  // Klientská část (krok 3A, Jakub 30. 9. 2026): pozvat a zrušit smí jen
  // administrátor. Podrobně v `klientska-cast.spec.ts`.
  test("stav klientské části vidí, pozvat klienta nemůže", async ({ page }) => {
    const [klient] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "clients" WHERE "deletedAt" IS NULL AND "mergedIntoId" IS NULL LIMIT 1`,
    );
    await page.goto(`/klienti/${klient!.id}`);
    await expect(page.getByText("Klientská část")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pozvat|Poslat pozvánku/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Zrušit přístup" })).toHaveCount(0);
  });

  // Zprávy klientovi (3A, Jakub 4. 10. 2026): historii vidí každý, poslat
  // smí jen administrátor. Podrobně v `oznameni.spec.ts`.
  test("zprávy klientovi vidí, poslat nemůže", async ({ page }) => {
    // Klient s aktivním účtem — přihlašovat se nebude, otisk hesla stačí vymyšlený.
    const znacka = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const [klient] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES ($1, $2, $3, 'landing-page', now())
       RETURNING "id"`,
      [`e2eopr${znacka}`, `Oprávnění Zprávy ${znacka}`, `opravneni-${znacka}@example.test`],
    );
    await dotaz(
      `INSERT INTO "client_accounts"
         ("id", "clientId", "passwordHash", "passwordSetAt", "invitedAt", "updatedAt")
       VALUES ($1, $2, 'neni-to-heslo', now(), now(), now())`,
      [`e2eopr${znacka}`, klient!.id],
    );
    await page.goto(`/klienti/${klient!.id}`);
    await page.getByRole("button", { name: /^Zprávy \(\d+\)$/ }).click();
    await expect(page.getByRole("dialog", { name: "Zprávy klientovi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Poslat zprávu" })).toHaveCount(0);
  });

  test("do klientské části se nedostane", async ({ page }) => {
    await page.goto("/ucet");
    await expect(page).toHaveURL(/\/ucet\/prihlaseni/);
  });
});

test.describe("administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("vidí celé menu a otevře všechny sekce", async ({ page }) => {
    await page.goto("/dashboard");
    const panel = await menu(page);

    for (const polozka of [...MENU_PRO_VSECHNY, ...MENU_JEN_ADMIN]) {
      await expect(panel.getByRole("link", { name: polozka, exact: true })).toBeVisible();
    }

    for (const adresa of JEN_ADMIN) {
      const odpoved = await page.goto(adresa);
      expect(odpoved?.status(), `${adresa} má být dostupná`).toBe(200);
      await expect(page.getByText("Tady nic není")).toHaveCount(0);
    }
  });

  test("průvodce ukázkou mimo ukázkový režim nevidí", async ({ page }) => {
    // Jen ukázkové účty v ukázkovém režimu (Jakub, 22. 10. 2026).
    await page.goto("/dashboard");
    await expect(page.getByText(/Vítej, /)).toBeVisible();
    await expect(page.getByText("Co si tu vyzkoušet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Co si vyzkoušet/ })).toHaveCount(0);
  });
});

test.describe("sekce schované z menu", () => {
  for (const role of ["uzivatel", "admin"] as const satisfies RoleTestu[]) {
    test.describe(role, () => {
      test.use({ storageState: stavPrihlaseni(role) });

      test("Brokeři v menu nejsou, stránka funguje; Hovory ani Portfolia už nejsou", async ({
        page,
      }) => {
        await page.goto("/dashboard");
        const panel = await menu(page);
        for (const { polozka } of SKRYTE_V_MENU) {
          await expect(panel.getByRole("link", { name: polozka, exact: true })).toHaveCount(0);
        }

        for (const { polozka, adresa } of SKRYTE_V_MENU) {
          const odpoved = await page.goto(adresa);
          expect(odpoved?.status(), `${adresa} má být dostupná`).toBe(200);
          // Název v horní liště zůstává, i když položka v menu není.
          await expect(
            page.locator("header").getByText(polozka, { exact: true }).first(),
          ).toBeVisible();
        }

        // Hovory z CRM zmizely úplně (Jakub, 20. 10. 2026) — ani v menu,
        // ani na adrese.
        await expect(panel.getByRole("link", { name: "Hovory", exact: true })).toHaveCount(0);
        expect((await page.goto("/hovory"))?.status(), "/hovory už neexistuje").toBe(404);
        // Portfolia taky (Jakub, 20. 10. 2026).
        await expect(panel.getByRole("link", { name: "Portfolia", exact: true })).toHaveCount(0);
        expect((await page.goto("/portfolia"))?.status(), "/portfolia už neexistuje").toBe(404);
      });
    });
  }
});

/**
 * Viditelnost klientů — **obě role vidí všechny** (Jakub, 22. 9. 2026).
 *
 * Dřív tu stál opačný test: obchodník cizího klienta nenašel ani
 * hledáním, ani přímou adresou karty. Klienti se přestali přiřazovat,
 * takže se pravidlo obrátilo a test s ním.
 */
test.describe("viditelnost klientů", () => {
  for (const role of ["uzivatel", "admin"] as const satisfies RoleTestu[]) {
    test.describe(role, () => {
      test.use({ storageState: stavPrihlaseni(role) });

      test("vidí všechny klienty, i ty cizí", async ({ page }) => {
        await page.goto("/klienti");
        await page.getByRole("link", { name: CIZI_KLIENT }).click();
        await expect(page.getByRole("heading", { name: CIZI_KLIENT })).toBeVisible();
      });

      test("karta cizího klienta se otevře i přímou adresou", async ({ page }) => {
        const [cizi] = await dotaz<{ id: string }>(`SELECT "id" FROM "clients" WHERE "name" = $1`, [
          CIZI_KLIENT,
        ]);
        expect(cizi, "ukázkový klient ze seedu").toBeDefined();

        const odpoved = await page.goto(`/klienti/${cizi!.id}`);
        expect(odpoved?.status(), "karta klienta má být dostupná").toBe(200);
        await expect(page.getByRole("heading", { name: CIZI_KLIENT })).toBeVisible();
      });
    });
  }

  test.describe("uživatel: klient nemá obchodníka", () => {
    test.use({ storageState: stavPrihlaseni("uzivatel") });

    test("sloupec ani kolonka Obchodník nikde nejsou", async ({ page }) => {
      await page.goto("/klienti");
      const obsah = page.getByRole("main");
      await expect(obsah.getByText("Obchodník", { exact: true })).toHaveCount(0);

      await page.getByRole("link", { name: CIZI_KLIENT }).click();
      await expect(page.getByRole("heading", { name: CIZI_KLIENT })).toBeVisible();
      await expect(page.getByRole("main").getByText("Obchodník", { exact: true })).toHaveCount(0);
    });
  });
});
