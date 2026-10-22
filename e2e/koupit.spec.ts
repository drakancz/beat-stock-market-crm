import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Koupit v klientské části (Jakub, 20. 10. 2026).
 *
 * | Kdo           | Smí                                                        |
 * | ------------- | ---------------------------------------------------------- |
 * | klient        | koupit jen za sebe, se slevovým kódem; převod nebo karta   |
 * | uživatel      | objednávku vidět v CRM se značkou „z klientské části“      |
 * | administrátor | navíc přepnout Zaplaceno (jako u každé objednávky)         |
 * | nepřihlášený  | nic                                                        |
 *
 * V testech je brána GoPay zapnutá proti napodobenině
 * (`e2e/napodobenina-gopay.mjs`), takže Objednat vede rovnou na ni.
 * Číslo účtu firmy je pro všechny testy stejné, ať se souběžné běhy
 * nepřepisují.
 */

const UCET = "19-2000145399/0800";
const IBAN = "CZ6508000000192000145399";

async function nastavUcetFirmy() {
  await dotaz(
    `INSERT INTO "company_settings" ("id", "bankAccount", "updatedAt") VALUES ('firma', $1, now())
     ON CONFLICT ("id") DO UPDATE SET "bankAccount" = $1`,
    [UCET],
  );
}

/** Slevový kód 20 % rovnou v databázi. */
async function zalozKod(): Promise<string> {
  const kod = `E2EKUP${pripona().toUpperCase()}`;
  await dotaz(
    `INSERT INTO "discount_codes" ("id", "code", "kind", "value", "updatedAt")
     VALUES ($1, $2, 'PROCENTA', 20, now())`,
    [`e2ekup${pripona()}`, kod],
  );
  return kod;
}

async function objednavkyKlienta(clientId: string) {
  return dotaz<{
    number: string;
    status: string;
    channel: string;
    discountCodeId: string | null;
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
  }>(
    `SELECT "number", "status", "channel", "discountCodeId", "termsVersion", "termsAcceptedAt"
       FROM "orders"
      WHERE "clientId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt"`,
    [clientId],
  );
}

test.describe("Koupit — klient", () => {
  test("koupí kurz se slevou, převod ukáže QR a VS, zaplatí kartou; v CRM z klientské části", async ({
    browser,
  }) => {
    await nastavUcetFirmy();
    const nazev = `E2E Kurz na koupi ${pripona()}`;
    await zalozProdukt(nazev, "KURZ");
    const kod = await zalozKod();
    const klient = await zalozKlientaSUctem(`Kupující ${pripona()}`);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.getByRole("link", { name: "Koupit" }).first().click();
    await expect(page.getByRole("heading", { name: "Koupit", level: 1 })).toBeVisible();
    const radek = page.getByTestId("produkt-k-nakupu").filter({ hasText: nazev });
    // 1 000 Kč bez DPH + 21 %.
    await expect(radek).toContainText("1 210");
    await bezVodorovnehoPosuvu(page);

    await radek.getByRole("button", { name: `Koupit: ${nazev}` }).click();
    const okno = page.getByRole("dialog", { name: "Koupit" });
    // Bez souhlasu s obchodními podmínkami objednat nejde; odkaz na ně je v okně.
    await expect(okno.getByRole("button", { name: "Objednat" })).toBeDisabled();
    await expect(okno.getByRole("link", { name: "obchodními podmínkami" })).toHaveAttribute(
      "href",
      "/ucet/obchodni-podminky",
    );
    await okno.getByRole("checkbox", { name: /Souhlasím s obchodními podmínkami/ }).check();
    // Neplatný kód se odmítne a nic se neobjedná.
    await okno.getByLabel("Slevový kód (nepovinné)").fill("NEEXISTUJE123");
    await okno.getByRole("button", { name: "Použít" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Slevový kód neexistuje." }),
    ).toBeVisible();
    await okno.getByRole("button", { name: "Objednat" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Slevový kód neexistuje." }).last(),
    ).toBeVisible();
    expect(await objednavkyKlienta(klient.id)).toHaveLength(0);

    await okno.getByLabel("Slevový kód (nepovinné)").fill(kod.toLowerCase());
    await okno.getByRole("button", { name: "Použít" }).click();
    await cekejNaUspech(page, `Kód ${kod} platí.`);
    // 1 210 Kč − 20 %.
    await expect(okno.getByTestId("k-uhrade")).toContainText("968");
    await okno.getByRole("button", { name: "Objednat" }).click();
    await expect(page).toHaveURL(/localhost:3197\/brana\/\d+/);

    const [objednavka] = await objednavkyKlienta(klient.id);
    expect(objednavka).toMatchObject({ status: "NOVA", channel: "KLIENTSKA_CAST" });
    expect(objednavka!.discountCodeId).not.toBeNull();
    // Souhlas se uložil i se zněním podmínek.
    expect(objednavka!.termsVersion).toMatch(/^\d{1,2}\. \d{1,2}\. \d{4}$/);
    expect(objednavka!.termsAcceptedAt).not.toBeNull();

    // Údaje k převodu u vlastní objednávky: částka, IBAN, VS, QR.
    await page.goto(`/ucet/platba-prevodem?cislo=${objednavka!.number}`);
    await expect(page.getByTestId("castka")).toContainText("968");
    await expect(page.getByText(IBAN)).toBeVisible();
    await expect(page.getByTestId("vs")).toHaveText(objednavka!.number.replace("-", ""));
    await expect(page.getByRole("img", { name: "QR platba" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // Kartou přes bránu.
    await page.getByRole("button", { name: `Zaplatit objednávku ${objednavka!.number}` }).click();
    await expect(page).toHaveURL(/localhost:3197\/brana\/\d+/);
    await page.getByRole("link", { name: "Zaplatit" }).click();
    await expect(page.getByRole("heading", { name: "Děkujeme za platbu" })).toBeVisible();
    expect((await objednavkyKlienta(klient.id))[0]!.status).toBe("ZAPLACENO");
    await page.context().close();

    // V CRM je objednávka vidět se značkou.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const crm = await tym.newPage();
    const radekCrm = crm.getByRole("row").filter({ hasText: objednavka!.number });
    await otevriAzUvidis(crm, `/objednavky?hledat=${objednavka!.number}`, radekCrm);
    await expect(radekCrm.getByText("z klientské části")).toBeVisible();
    await tym.close();
  });

  test("Prodloužit z Přehledu otevře nákup členství; víc než 3 nezaplacené nejde", async ({
    browser,
  }) => {
    await nastavUcetFirmy();
    const klient = await zalozKlientaSUctem(`Prodlužující ${pripona()}`);
    const clenstvi = await zalozProdukt(`E2E Členství na prodloužení ${pripona()}`, "CLENSTVI");
    await zaplatProdukt(klient.id, clenstvi);
    await dotaz(
      `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, now() + interval '10 days', now())
       ON CONFLICT ("clientId", "productId") DO UPDATE SET "validUntil" = EXCLUDED."validUntil"`,
      [klient.id, clenstvi],
    );

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page
      .getByRole("list", { name: "Členství a produkty" })
      .getByRole("link", { name: "Prodloužit" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/ucet/koupit\\?produkt=${clenstvi}`));
    const okno = page.getByRole("dialog", { name: "Prodloužit" });
    await expect(okno).toBeVisible();
    await page.keyboard.press("Escape");

    // Tři nezaplacené objednávky už má — čtvrtou nedostane.
    for (let i = 0; i < 3; i += 1) {
      await dotaz(
        `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "updatedAt")
         VALUES ($1, 'E2E nezaplacená', $2, 'NOVA', 'CZK', now())`,
        [`e2enez${pripona()}${i}`, klient.id],
      );
    }
    await page
      .getByTestId("produkt-k-nakupu")
      .filter({ hasText: "Členství na prodloužení" })
      .getByRole("button", { name: /Prodloužit:/ })
      .click();
    await okno.getByRole("checkbox", { name: /Souhlasím s obchodními podmínkami/ }).check();
    await okno.getByRole("button", { name: "Objednat" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "nezaplacených objednávek" }),
    ).toBeVisible();
    expect(
      (await objednavkyKlienta(klient.id)).filter((o) => o.channel === "KLIENTSKA_CAST"),
    ).toHaveLength(0);
    await page.context().close();
  });

  test("cizí objednávku na stránce převodu neuvidí (404)", async ({ browser }) => {
    const prvni = await zalozKlientaSUctem(`Majitel ${pripona()}`);
    const druhy = await zalozKlientaSUctem(`Zvědavý ${pripona()}`);
    const [cizi] = await dotaz<{ number: string }>(
      `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "updatedAt")
       VALUES ($1, 'E2E cizí', $2, 'NOVA', 'CZK', now()) RETURNING "number"`,
      [`e2ecizi${pripona()}`, prvni.id],
    );

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, druhy.email, druhy.heslo);
    const odpoved = await page.goto(`/ucet/platba-prevodem?cislo=${cizi!.number}`);
    expect(odpoved?.status()).toBe(404);
    await page.context().close();
  });
});

test.describe("Koupit — nepřihlášený", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("na Koupit ani na převod nesmí", async ({ page }) => {
    for (const adresa of ["/ucet/koupit", "/ucet/platba-prevodem?cislo=2026-0001"]) {
      await page.goto(adresa);
      await expect(page).toHaveURL(/\/ucet\/prihlaseni/);
    }
  });

  test("obchodní podmínky vidí i bez přihlášení, i s odkazem v patičce", async ({ page }) => {
    await page.goto("/ucet/prihlaseni");
    await expect(async () => {
      await page.getByRole("link", { name: "Obchodní podmínky" }).click();
      await expect(page).toHaveURL(/\/ucet\/obchodni-podminky$/, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Obchodní podmínky", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Odstoupení od smlouvy/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Nejde o investiční doporučení/ }),
    ).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});
