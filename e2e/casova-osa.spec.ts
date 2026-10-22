import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  dotaz,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Časová osa klienta (Fáze 5B, Jakub 16. 10. 2026).
 *
 * - Okno Časová osa na kartě vidí každý přihlášený.
 * - Druh **Změny** (auditní log) jen administrátor — uživatel nemá
 *   přepínač a server mu ho nevydá ani při přímém volání akce.
 * - Filtr podle druhu ukáže jen ten druh.
 */

/** Klient s poznámkou, zaplacenou objednávkou a záznamem v auditu. */
async function pripravKlienta(page: Page) {
  const jmeno = `Osa ${pripona()}`;
  // Pomůcka vrací adresu karty (`/klienti/<id>`), id je poslední část.
  const id = (await zalozKlientaFormularem(page, jmeno)).split("/").pop()!;
  const poznamka = `Poznamka na ose ${pripona()}`;
  await dotaz(
    `INSERT INTO "client_notes" ("id", "clientId", "text", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, now() - interval '1 day', now())`,
    [id, poznamka],
  );
  const [objednavka] = await dotaz<{ number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'ZAPLACENO', 'CZK',
             now() - interval '2 days', now() - interval '3 days', now())
     RETURNING "number"`,
    [id],
  );
  return { id, jmeno, poznamka, cislo: objednavka!.number };
}

async function otevriOsu(page: Page, id: string) {
  await page.goto(`/klienti/${id}`);
  await page.getByRole("button", { name: "Časová osa" }).click();
  const okno = page.getByRole("dialog", { name: "Časová osa" });
  await expect(okno.getByRole("list", { name: "Časová osa klienta" })).toBeVisible();
  return okno;
}

test.describe("časová osa — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "vidí objednávky a poznámky, filtr funguje, Změny nemá",
    { tag: "@telefon" },
    async ({ page }) => {
      const klient = await pripravKlienta(page);
      const okno = await otevriOsu(page, klient.id);

      await expect(okno.getByText(new RegExp(`^Objednávka ${klient.cislo} \\(`))).toBeVisible();
      await expect(okno.getByText(`Zaplaceno: objednávka ${klient.cislo}`)).toBeVisible();
      await expect(okno.getByText(klient.poznamka)).toBeVisible();
      await expect(okno.getByText("Klient v CRM")).toBeVisible();

      // Uživatel nemá přepínač Změny ani řádky z auditu.
      await expect(okno.getByRole("button", { name: "Změny" })).toHaveCount(0);
      await expect(okno.getByText("Založení klienta")).toHaveCount(0);

      // Filtr Tým: poznámka ano, objednávka ne.
      await okno.getByRole("button", { name: "Tým" }).click();
      await expect(okno.getByRole("button", { name: "Tým" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(okno.getByText(new RegExp(`^Objednávka ${klient.cislo} \\(`))).toHaveCount(0);
      await expect(okno.getByText(klient.poznamka)).toBeVisible();

      // Filtr Objednávky: naopak.
      await okno.getByRole("button", { name: "Objednávky" }).click();
      await expect(okno.getByText(klient.poznamka)).toHaveCount(0);
      await expect(okno.getByText(new RegExp(`^Objednávka ${klient.cislo} \\(`))).toBeVisible();

      await bezVodorovnehoPosuvu(page);
    },
  );

  test("Změny nedostane ani přímým voláním akce", async ({ page }) => {
    const klient = await pripravKlienta(page);
    await page.goto(`/klienti/${klient.id}`);

    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      page.getByRole("button", { name: "Časová osa" }).click(),
    ]);
    const telo = akce.postData() ?? "";
    expect(telo).toContain("null,null]");

    const odpoved = await page.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: telo.replace("null,null]", '"zmeny",null]'),
    });
    const text = await odpoved.text();
    expect(text).toContain('"ok":false');
    expect(text).not.toContain("Založení klienta");
  });

  test("neexistující klient je 404", async ({ page }) => {
    const odpoved = await page.goto("/klienti/neexistuje-osa");
    expect(odpoved?.status()).toBe(404);
  });
});

test.describe("časová osa — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("vidí i Změny z auditu", async ({ page }) => {
    const klient = await pripravKlienta(page);
    const okno = await otevriOsu(page, klient.id);

    await okno.getByRole("button", { name: "Změny" }).click();
    await expect(okno.getByText("Založení klienta")).toBeVisible();
    await expect(okno.getByText(klient.poznamka)).toHaveCount(0);
  });
});
