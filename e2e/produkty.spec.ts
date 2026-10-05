import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  jeMobil,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Produkty (Jakub, 24. 9. 2026).
 *
 * - **Odkaz na stránku produktu** zadává jen administrátor, jen `https`.
 *   Název produktu je pak v ceníku odkazem do nové záložky; vidí ho každý
 *   přihlášený. Stránka vznikne v samostatném projektu.
 * - **Prodáno** je součet kusů v zaplacených objednávkách — nezaplacené
 *   a smazané se nepočítají. Nahradilo sloupec Zájem.
 *
 * Produkty i objednávky se zapisují přímo SQL, ať test nezávisí na
 * nabídce názvů ve formuláři.
 */

/** Zapíše produkt do ceníku a vrátí jeho id. */
async function zalozProdukt(nazev: string, url: string | null = null): Promise<string> {
  const [radek] = await dotaz<{ id: string }>(
    `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency",
                             "active", "url", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'KURZ', 1000, 'zakladni', 'CZK', true, $2, now(), now())
     RETURNING "id"`,
    [nazev, url],
  );
  return radek!.id;
}

/** Objednávka s jedním produktem v daném počtu kusů. */
async function zalozObjednavku(
  clientId: string,
  productId: string,
  kusu: number,
  stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO",
  smazana = false,
) {
  const [objednavka] = await dotaz<{ id: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "deletedAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, $2::"OrderStatus", 'CZK',
             CASE WHEN $2 = 'ZAPLACENO' THEN now() ELSE NULL END,
             CASE WHEN $3 THEN now() ELSE NULL END, now(), now())
     RETURNING "id"`,
    [clientId, stav, smazana],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, $3)`,
    [objednavka!.id, productId, kusu],
  );
}

test.describe("produkty očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("odkaz na stránku produktu: zadat, jen https", async ({ page }) => {
    const nazev = `Kurz Odkaz ${pripona()}`;
    await zalozProdukt(nazev);

    const upravit = page.getByRole("button", { name: `Upravit ${nazev}` });
    await otevriAzUvidis(page, "/produkty", upravit);
    // Bez odkazu je název obyčejný text.
    await expect(page.getByRole("link", { name: nazev })).toHaveCount(0);

    await upravit.click();
    const dialog = page.getByRole("dialog", { name: "Upravit produkt" });

    // http ani javascript: neprojdou — okno zůstane otevřené s chybou.
    for (const spatny of ["http://example.com/kurz", "javascript:alert(1)"]) {
      await dialog.getByLabel("Odkaz na stránku produktu").fill(spatny);
      await dialog.getByRole("button", { name: "Uložit změny" }).click();
      await expect(dialog.getByText(/musí začínat https:\/\//)).toBeVisible();
    }

    const adresa = `https://example.com/produkt/${pripona()}`;
    await dialog.getByLabel("Odkaz na stránku produktu").fill(adresa);
    await dialog.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, /je upravený/);

    const odkaz = page.getByRole("link", { name: nazev });
    await expect(odkaz).toHaveAttribute("href", adresa);
    await expect(odkaz).toHaveAttribute("target", "_blank");
    await expect(odkaz).toHaveAttribute("rel", /noopener/);
  });

  /*
   * Cena s DPH, nebo bez (Jakub, 27. 9. 2026). Výchozí je s DPH, ukládá se
   * vždy bez DPH a přepočet dělá server se sazbou z databáze.
   */
  test("cena se zadá s DPH a uloží bez DPH, přepínač přepočítá", async ({ page }) => {
    const nazev = `Kurz Cena ${pripona()}`;
    const produktId = await zalozProdukt(nazev);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    const upravit = page.getByRole("button", { name: `Upravit ${nazev}` });
    await otevriAzUvidis(page, "/produkty", upravit);
    await upravit.click();

    const dialog = page.getByRole("dialog", { name: "Upravit produkt" });
    // Předvyplněno s DPH: 1 000 Kč bez DPH je 1 210 Kč se základní sazbou.
    await expect(dialog.getByRole("radio", { name: "s DPH", exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Cena s DPH v Kč")).toHaveValue("1210");

    await dialog.getByLabel("Cena s DPH v Kč").fill("199");
    await expect(dialog.getByText(/Bez DPH: 164,46/)).toBeVisible();
    await dialog.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, /je upravený/);
    await expect(radek).toContainText("164,46");
    await expect(radek).toContainText("199,00");

    const [ulozeno] = await dotaz<{ cena: string }>(
      `SELECT "netPrice"::text AS "cena" FROM "products" WHERE "id" = $1`,
      [produktId],
    );
    expect(ulozeno!.cena).toBe("164.46");

    // Bez DPH: přepnutí převede, co je v políčku, a uloží se, co je napsané.
    await upravit.click();
    await dialog.getByRole("radio", { name: "bez DPH" }).check();
    await expect(dialog.getByLabel("Cena bez DPH v Kč")).toHaveValue("164,46");
    await dialog.getByLabel("Cena bez DPH v Kč").fill("2000");
    await dialog.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, /je upravený/);
    // Mezi tisíci je nezlomitelná mezera, proto \s.
    await expect(radek).toContainText(/2\s420,00/);
  });

  test("Prodáno počítá kusy jen v zaplacených objednávkách", async ({ page }) => {
    const nazev = `Kurz Prodej ${pripona()}`;
    const produkt = await zalozProdukt(nazev);
    const adresa = await zalozKlientaFormularem(page, `Produkt Kupec ${pripona()}`);
    const klient = adresa.split("/").pop()!;

    await zalozObjednavku(klient, produkt, 2, "ZAPLACENO");
    await zalozObjednavku(klient, produkt, 1, "ZAPLACENO");
    // Tyhle se nepočítají: nezaplacená, nová a smazaná zaplacená.
    await zalozObjednavku(klient, produkt, 5, "NEZAPLACENO");
    await zalozObjednavku(klient, produkt, 4, "NOVA");
    await zalozObjednavku(klient, produkt, 7, "ZAPLACENO", true);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);

    await expect(page.getByRole("columnheader", { name: "Prodáno" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Zájem" })).toHaveCount(0);
    await expect(radek.getByText("3 ks", { exact: true })).toBeVisible();
  });
});

/*
 * Přejmenování a smazání (Jakub, 27. 9. 2026). Mazat smí jen administrátor,
 * i produkt, který se prodal — jde do Smazaných a objednávky ho dál
 * ukazují. Nadobro jen produkt, na který nic neodkazuje.
 */
test.describe("přejmenování a smazání produktu", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("název se v okně Upravit přepíše obyčejným polem", async ({ page }) => {
    const nazev = `Kurz Stary ${pripona()}`;
    const novy = `Kurz Novy ${pripona()}`;
    await zalozProdukt(nazev);

    const upravit = page.getByRole("button", { name: `Upravit ${nazev}` });
    await otevriAzUvidis(page, "/produkty", upravit);
    await upravit.click();

    const dialog = page.getByRole("dialog", { name: "Upravit produkt" });
    await dialog.getByLabel("Název produktu").fill(novy);
    await dialog.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, /je upravený/);

    await expect(page.getByRole("row").filter({ hasText: novy })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: nazev })).toHaveCount(0);
  });

  test("prodaný produkt jde do Smazaných a odtud zpátky, nadobro ne", async ({ page }) => {
    const nazev = `Kurz Prodany ${pripona()}`;
    const produkt = await zalozProdukt(nazev);
    const adresa = await zalozKlientaFormularem(page, `Produkt Mazani ${pripona()}`);
    await zalozObjednavku(adresa.split("/").pop()!, produkt, 2, "ZAPLACENO");

    const upravit = page.getByRole("button", { name: `Upravit ${nazev}` });
    await otevriAzUvidis(page, "/produkty", upravit);
    await upravit.click();
    await page
      .getByRole("dialog", { name: "Upravit produkt" })
      .getByRole("button", { name: "Smazat" })
      .click();

    // Potvrzovací okno jmenuje produkt, říká, že to nejde vzít zpět,
    // a upozorní na prodané kusy.
    const potvrzeni = page.getByRole("dialog", { name: "Smazat produkt" });
    await expect(potvrzeni).toContainText(nazev);
    await expect(potvrzeni).toContainText("nelze vzít zpět");
    await expect(potvrzeni).toContainText("2 ks");

    // Zrušit nic nesmaže.
    await potvrzeni.getByRole("button", { name: "Zrušit" }).click();
    await expect(page.getByRole("row").filter({ hasText: nazev })).toBeVisible();

    await upravit.click();
    await page
      .getByRole("dialog", { name: "Upravit produkt" })
      .getByRole("button", { name: "Smazat" })
      .click();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, /Smazáno z ceníku/);
    await expect(page.getByRole("row").filter({ hasText: nazev })).toHaveCount(0);

    // Objednávka produkt dál drží.
    const [polozka] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "order_items" WHERE "productId" = $1`,
      [produkt],
    );
    expect(polozka!.pocet).toBe(1);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/smazane", radek);
    await expect(radek.getByRole("button", { name: "Trvale smazat" })).toBeDisabled();

    await radek.getByRole("button", { name: "Obnovit" }).click();
    await cekejNaUspech(page, /Zpátky v ceníku/);

    await otevriAzUvidis(page, "/produkty", page.getByRole("row").filter({ hasText: nazev }));
  });

  test("neprodaný produkt jde ze Smazaných smazat nadobro", async ({ page }) => {
    const nazev = `Kurz Nadobro ${pripona()}`;
    const produkt = await zalozProdukt(nazev);
    await dotaz(`UPDATE "products" SET "deletedAt" = now() WHERE "id" = $1`, [produkt]);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/smazane", radek);
    await radek.getByRole("button", { name: "Trvale smazat" }).click();

    const potvrzeni = page.getByRole("dialog", { name: "Opravdu smazat nenávratně?" });
    await expect(potvrzeni).toContainText(nazev);
    await potvrzeni.getByRole("button", { name: "Ano, smazat nenávratně" }).click();
    await cekejNaUspech(page, /Nadobro smazáno/);

    const [zbylo] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "products" WHERE "id" = $1`,
      [produkt],
    );
    expect(zbylo!.pocet).toBe(0);
  });

  test("po smazání jde název použít znovu, obnovení shodu odmítne", async ({ page }) => {
    const nazev = `Kurz Dvojnik ${pripona()}`;
    const stary = await zalozProdukt(nazev);
    await dotaz(`UPDATE "products" SET "deletedAt" = now() WHERE "id" = $1`, [stary]);
    await zalozProdukt(nazev);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/smazane", radek);
    await radek.getByRole("button", { name: "Obnovit" }).click();
    // Odmítnutí přijde jako upozornění v rohu a produkt zůstane ve Smazaných.
    await cekejNaUspech(page, /Přejmenuj ho/);
    await expect(radek).toBeVisible();
  });
});

test.describe("produkty očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("odkaz vidí, měnit nemůže", async ({ page }) => {
    const nazev = `Kurz Pro Tym ${pripona()}`;
    const adresa = `https://example.com/produkt/${pripona()}`;
    await zalozProdukt(nazev, adresa);

    const odkaz = page.getByRole("link", { name: nazev });
    await otevriAzUvidis(page, "/produkty", odkaz);
    await expect(odkaz).toHaveAttribute("href", adresa);

    await expect(page.getByRole("button", { name: `Upravit ${nazev}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Nový produkt" })).toHaveCount(0);
  });
});

test.describe("produkty na telefonu", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("formulář s odkazem nepřečnívá z okna", async ({ page }) => {
    test.skip(!jeMobil(page), "Týká se jen telefonu.");

    await page.goto("/produkty");
    await page.getByRole("button", { name: "Nový produkt" }).click();
    const dialog = page.getByRole("dialog", { name: "Nový produkt" });
    await expect(dialog.getByLabel("Odkaz na stránku produktu")).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});
