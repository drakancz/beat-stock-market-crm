import { expect, test } from "@playwright/test";

/**
 * Nepřihlášený návštěvník se nedostane na žádnou chráněnou stránku
 * ani k datům přes adresy API (security.md, pravidlo 1).
 */

const CHRANENE_STRANKY = [
  "/",
  // Zrušená obrazovka (22. 9. 2026). Adresa dál přesměrovává, ale
  // nepřihlášenému se nesmí stát zkratkou dovnitř.
  "/dnesek",
  "/dashboard",
  "/klienti",
  "/klienti/duplicity",
  "/objednavky",
  "/brokeri",
  "/produkty",
  "/produkty/slevove-kody",
  "/produkty/doporucitele",
  "/profil",
  "/sprava",
  "/sprava/uzivatele",
  "/smazane",
  "/smartemailing",
  "/smartemailing/chyby",
  "/nastaveni",
  "/nastaveni/aktivita",
];

test.describe("nepřihlášený návštěvník", () => {
  for (const adresa of CHRANENE_STRANKY) {
    test(`${adresa} přesměruje na přihlášení`, async ({ page }) => {
      await page.goto(adresa);

      await expect(page).toHaveURL(/\/prihlaseni/);
      await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeVisible();
      // Z přihlašovací stránky nesmí prosáknout nic z aplikace.
      await expect(page.getByText("Interní CRM")).toHaveCount(0);
    });
  }

  // Klientská část má vlastní přihlášení (krok 3A, 30. 9. 2026). Z něj
  // nesmí nic prosáknout z CRM.
  test("/ucet přesměruje na přihlášení klientů", async ({ page }) => {
    await page.goto("/ucet");
    await expect(page).toHaveURL(/\/ucet\/prihlaseni$/);
    await expect(page.getByRole("button", { name: "Přihlásit se" })).toBeVisible();
    await expect(page.getByText("Interní CRM")).toHaveCount(0);
  });

  test("po přihlášení se vrátí tam, kam chtěl", async ({ page }) => {
    await page.goto("/brokeri");
    await expect(page).toHaveURL(/\/prihlaseni\?pokracovat=%2Fbrokeri/);
  });

  test("export statistik vrátí 401", async ({ request }) => {
    const odpoved = await request.get("/dashboard/export", { maxRedirects: 0 });
    // Buď odbočení na přihlášení, nebo rovnou 401 — nikdy čísla firmy.
    expect([307, 401]).toContain(odpoved.status());
    expect(await odpoved.text()).not.toContain(";");
  });

  test("export objednávek klienta vrátí 401", async ({ request }) => {
    const odpoved = await request.get("/klienti/neexistuje/objednavky", { maxRedirects: 0 });
    // Buď odbočení na přihlášení, nebo rovnou 401 — nikdy data.
    expect([307, 401]).toContain(odpoved.status());
    expect(await odpoved.text()).not.toContain(";");
  });

  test("zápis aktivity vrátí 401", async ({ request }) => {
    const odpoved = await request.post("/api/aktivita", { data: { cesta: "/klienti" } });
    expect(odpoved.status()).toBe(401);
  });

  test("příjem leadů bez klíče nic nepřijme", async ({ request }) => {
    const odpoved = await request.post("/api/leady", {
      data: { jmeno: "Nikdo", email: "nikdo@example.test" },
    });
    // V testech klíč není nastavený, takže adresa je vypnutá (503);
    // se špatným klíčem by to bylo 401. Založení (201) nesmí projít.
    expect([401, 503]).toContain(odpoved.status());
  });

  test("webhook SmartEmailingu bez hesla nic nepřijme", async ({ request }) => {
    const odpoved = await request.post("/api/smartemailing/odhlaseni", { data: {} });
    expect([401, 503]).toContain(odpoved.status());
  });
});
