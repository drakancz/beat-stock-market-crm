import { expect, test } from "@playwright/test";

import { cekejNaUspech, dotaz, otevriAzUvidis, pripona, stavPrihlaseni } from "./pomocne";

/**
 * Hledání bez ohledu na diakritiku (Jakub, 25. 9. 2026).
 *
 * „maresova" najde „Marešová" — v seznamu klientů (jméno, e-mail),
 * v Objednávkách (jméno klienta, produkt) a ve výběru klienta u Nového
 * úkolu na Dashboardu. Hledá každý přihlášený; rozsah se nemění.
 *
 * Klient s diakritikou se zakládá SQL: formulář by z jména odvodil
 * e-mail s háčky.
 */

/** Klient se jménem s diakritikou a jeho objednávka produktu s diakritikou. */
async function pripravData() {
  const znacka = pripona();
  const jmeno = `Žofie Marešová ${znacka}`;
  const produkt = `Členství Řízení ${znacka}`;

  const [zdroj] = await dotaz<{ id: string }>(`SELECT "id" FROM "client_sources" LIMIT 1`);
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, now())
     RETURNING "id"`,
    [jmeno, `zofie-${znacka}@example.test`, zdroj!.id],
  );
  const [radekProduktu] = await dotaz<{ id: string }>(
    `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency",
                             "active", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'CLENSTVI', 1000,
             (SELECT "id" FROM "vat_rates" ORDER BY "order" LIMIT 1), 'CZK', true, now(), now())
     RETURNING "id"`,
    [produkt],
  );
  const [objednavka] = await dotaz<{ id: string; number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Členství', $1, 'NOVA', 'CZK', now(), now())
     RETURNING "id", "number"`,
    [klient!.id],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1, now())`,
    [objednavka!.id, radekProduktu!.id],
  );

  return { znacka, jmeno, produkt, cislo: objednavka!.number };
}

test.describe("hledání bez diakritiky", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("klienti: bez háčků i velkými písmeny", async ({ page }) => {
    const { znacka, jmeno } = await pripravData();
    const odkaz = page.getByRole("link", { name: jmeno });

    await otevriAzUvidis(
      page,
      `/klienti?hledat=${encodeURIComponent(`zofie maresova ${znacka}`)}`,
      odkaz,
    );
    await otevriAzUvidis(
      page,
      `/klienti?hledat=${encodeURIComponent(`MARESOVA ${znacka}`)}`,
      odkaz,
    );
    // S diakritikou to funguje dál.
    await otevriAzUvidis(
      page,
      `/klienti?hledat=${encodeURIComponent(`Marešová ${znacka}`)}`,
      odkaz,
    );

    // Jiné jméno se nenajde — hledání pořád filtruje.
    await page.goto(`/klienti?hledat=${encodeURIComponent(`novakova ${znacka}`)}`);
    await expect(page.getByText("Nikdo neodpovídá zadání.")).toBeVisible();
  });

  test("objednávky: podle klienta i produktu bez háčků", async ({ page }) => {
    const { znacka, cislo } = await pripravData();
    const radek = page.getByRole("row").filter({ hasText: cislo });

    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${encodeURIComponent(`maresova ${znacka}`)}`,
      radek,
    );
    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${encodeURIComponent(`clenstvi rizeni ${znacka}`)}`,
      radek,
    );
  });

  test("nový úkol: klient se najde bez háčků", async ({ page }) => {
    const { znacka, jmeno } = await pripravData();
    const nazev = `Zavolat Žofii ${pripona()}`;

    await otevriAzUvidis(page, "/dashboard", page.getByRole("button", { name: "Nový úkol" }));
    await page.getByRole("button", { name: "Nový úkol" }).click();
    const okno = page.getByRole("dialog", { name: "Nový úkol" });

    // Klient není předvybraný — musí se zvolit.
    await expect(okno.getByRole("combobox", { name: "Klient" })).toHaveText(/Vyber klienta/);

    await okno.getByRole("combobox", { name: "Klient" }).click();
    // Ne `getByPlaceholder`: stejný text má i hledání v horní liště.
    await page.getByRole("combobox", { name: "Hledat klienta…" }).fill(`zofie maresova ${znacka}`);
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: jmeno }).click();
    await expect(okno.getByRole("combobox", { name: "Klient" })).toHaveText(jmeno);

    await okno.getByLabel("Co je potřeba").fill(nazev);
    await okno.getByRole("button", { name: "Založit úkol" }).click();
    await cekejNaUspech(page, "je založený");
  });
});
