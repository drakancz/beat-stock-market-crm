import { randomBytes } from "node:crypto";

import { expect, type Browser, type Page } from "@playwright/test";

import { zahesluj } from "../src/lib/hesla";

import { dotaz, nahodnaAdresa, pripona } from "./pomocne";

/**
 * Pomůcky pro testy klientské části (krok 3C a dál). Klienti, účty,
 * produkty a objednávky se zakládají přímo SQL; chování se zkouší
 * v prohlížeči.
 */

/** Klient s hotovým účtem do klientské části a náhodným heslem. */
export async function zalozKlientaSUctem(jmeno: string) {
  const email = `klient-${pripona()}@example.test`;
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, 'landing-page', now())
     RETURNING "id"`,
    [`e2e${pripona()}${pripona()}`, jmeno, email],
  );
  const heslo = randomBytes(18).toString("base64url");
  await dotaz(
    `INSERT INTO "client_accounts"
       ("id", "clientId", "passwordHash", "passwordSetAt", "invitedAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now(), now())`,
    [`e2e${pripona()}${pripona()}`, klient!.id, await zahesluj(heslo)],
  );
  return { id: klient!.id, email, name: jmeno, heslo };
}

/** Vlastní produkt v ceníku, ať se souběžné testy nepletou. */
export async function zalozProdukt(
  nazev: string,
  druh: "KURZ" | "CLENSTVI" | "KONZULTACE" = "KURZ",
  url: string | null = null,
) {
  const [produkt] = await dotaz<{ id: string }>(
    `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency", "url",
                             "validityMonths", "updatedAt")
     SELECT gen_random_uuid()::text, $1, $2::"ProductKind", 1000, "id", 'CZK', $3,
            CASE WHEN $2 = 'CLENSTVI' THEN 12 ELSE NULL END, now()
       FROM "vat_rates" WHERE "rate" = 21 LIMIT 1
     RETURNING "id"`,
    [nazev, druh, url],
  );
  return produkt!.id;
}

/** Zaplacená objednávka produktu (cenu doplní databáze sama). */
export async function zaplatProdukt(clientId: string, productId: string) {
  const [objednavka] = await dotaz<{ id: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'ZAPLACENO', 'CZK', now(), now(), now())
     RETURNING "id"`,
    [clientId],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, productId],
  );
  return objednavka!.id;
}

/** Nový prohlížeč bez přihlášení — tak, jak přijde klient. */
export async function prohlizecKlienta(browser: Browser): Promise<Page> {
  const kontext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await kontext.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  return kontext.newPage();
}

export async function prihlasKlienta(page: Page, email: string, heslo: string) {
  await page.goto("/ucet/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill(heslo);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("heading", { name: /Dobrý den/ })).toBeVisible();
}
