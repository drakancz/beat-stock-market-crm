import { expect, test, type Page } from "@playwright/test";

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

// Údaje firmy jsou společné pro celou testovací databázi a bez nich se faktura
// nevystaví (pojistka, 19. 10. 2026) — testy v souboru proto běží po sobě.
test.describe.configure({ mode: "serial" });

async function nastavFirmu(ico: string | null) {
  await dotaz(
    `INSERT INTO "company_settings" ("id", "ico", "dic", "address", "vatPayer", "updatedAt")
     VALUES ('firma', $1, 'CZ12345678', 'Zkušební 1, 110 00 Praha', true, now())
     ON CONFLICT ("id") DO UPDATE SET "ico" = $1, "dic" = 'CZ12345678',
       "address" = 'Zkušební 1, 110 00 Praha', "vatPayer" = true`,
    [ico],
  );
}

test.beforeAll(async () => {
  await nastavFirmu("12345678");
});

/**
 * Faktury a dobropisy (Jakub, 19. 10. 2026).
 *
 * - Faktura vznikne sama po zaplacení (tady přes napodobeninu GoPay),
 *   s fakturačními údaji z Mého profilu; bez adresy zjednodušený doklad.
 * - PDF stáhne klient (jen svou) a tým; cizí klient dostane 404.
 * - Dobropis a ruční vystavení u starší objednávky **jen administrátor**
 *   (i přímé volání akce).
 * - Export CSV, Pohoda XML a ISDOC.
 */

async function nezaplacenaObjednavka(clientId: string) {
  const produkt = await zalozProdukt(`E2E Faktura ${pripona()}`);
  const [objednavka] = await dotaz<{ id: string; number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'NOVA', 'CZK', now()) RETURNING "id", "number"`,
    [clientId],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, produkt],
  );
  return objednavka!;
}

/** Faktura k objednávce — vzniká až po odpovědi, proto se čeká. */
async function cekejNaFakturu(orderId: string) {
  let faktura: { id: string; number: string; simplified: boolean; customer: unknown } | undefined;
  await expect(async () => {
    [faktura] = await dotaz(
      `SELECT "id", "number", "simplified", "customer" FROM "invoices"
        WHERE "orderId" = $1 AND "kind" = 'FAKTURA'`,
      [orderId],
    );
    expect(faktura).toBeDefined();
  }).toPass({ timeout: 20_000 });
  return faktura!;
}

async function zaplatVKlientskeCasti(page: Page, cislo: string) {
  // Hned po uložení profilu — holé goto() by se srazilo s router.refresh().
  const zaplatit = page.getByRole("button", { name: `Zaplatit objednávku ${cislo}` });
  await otevriAzUvidis(page, "/ucet", zaplatit);
  // Na pomalém iPhonu může klik přijít dřív, než stránka ožije — opakovat,
  // dokud nejsme na bráně.
  await expect(async () => {
    await zaplatit.click();
    await expect(page).toHaveURL(/\/brana\/\d+/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("link", { name: "Zaplatit" }).click();
  await expect(page.getByRole("heading", { name: "Děkujeme za platbu" })).toBeVisible();
}

test.describe("faktury — klient", () => {
  test(
    "po zaplacení vznikne faktura s údaji z profilu; stáhne ji klient i tým, cizí klient ne",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Fakturovaný ${pripona()}`);
      const objednavka = await nezaplacenaObjednavka(klient.id);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);

      // Fakturační údaje v Mém profilu — neplatné IČO neprojde.
      await page.goto("/ucet/profil");
      await page.getByLabel("Ulice a číslo").fill("Dlouhá 1");
      await page.getByLabel("Město").fill("Praha");
      await page.getByLabel("PSČ").fill("110 00");
      await page.getByLabel("IČO (nepovinné)").fill("123");
      await page.getByRole("button", { name: "Uložit fakturační údaje" }).click();
      await expect(page.getByText("IČO má osm číslic.")).toBeVisible();
      await page.getByLabel("IČO (nepovinné)").fill("12345678");
      await page.getByRole("button", { name: "Uložit fakturační údaje" }).click();
      await cekejNaUspech(page, "Fakturační údaje jsou uložené.");
      await bezVodorovnehoPosuvu(page);

      await zaplatVKlientskeCasti(page, objednavka.number);
      const faktura = await cekejNaFakturu(objednavka.id);
      expect(faktura.number).toMatch(/^FV-\d{4}-\d{4,}$/);
      expect(faktura.simplified).toBe(false);
      expect(JSON.stringify(faktura.customer)).toContain("Dlouhá 1");

      // Klient fakturu vidí a stáhne.
      await page.goto("/ucet");
      await expect(page.getByRole("link", { name: `Faktura ${faktura.number}` })).toBeVisible();
      const pdf = await page.request.get(`/ucet/faktura/${faktura.id}`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
      await page.context().close();

      // Cizí klient ji nedostane.
      const cizi = await zalozKlientaSUctem(`Cizí fakturový ${pripona()}`);
      const druha = await prohlizecKlienta(browser);
      await prihlasKlienta(druha, cizi.email, cizi.heslo);
      expect((await druha.request.get(`/ucet/faktura/${faktura.id}`)).status()).toBe(404);
      await druha.context().close();

      // Tým ji stáhne v CRM.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const odpoved = await tym.request.get(`/objednavky/faktura/${faktura.id}`);
      expect(odpoved.status()).toBe(200);
      expect(odpoved.headers()["content-type"]).toBe("application/pdf");
      await tym.close();
    },
  );

  test("bez adresy vznikne zjednodušený doklad", { tag: "@telefon" }, async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Bez adresy ${pripona()}`);
    const objednavka = await nezaplacenaObjednavka(klient.id);
    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await zaplatVKlientskeCasti(page, objednavka.number);
    const faktura = await cekejNaFakturu(objednavka.id);
    expect(faktura.simplified).toBe(true);
    await page.context().close();
  });
});

test.describe("faktury — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("vystaví fakturu ke starší objednávce a dobropis; uživatel ne ani přímým voláním", async ({
    page,
    browser,
  }) => {
    // Zaplacená „před spuštěním“ — fakturu nemá.
    const klient = await zalozKlientaSUctem(`Starší ${pripona()}`);
    const orderId = await zaplatProdukt(klient.id, await zalozProdukt(`E2E Starší ${pripona()}`));
    const [{ number: cislo }] = (await dotaz<{ number: string }>(
      `SELECT "number" FROM "orders" WHERE "id" = $1`,
      [orderId],
    )) as [{ number: string }];

    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${cislo}`,
      page.getByRole("button", { name: "Vystavit fakturu" }),
    );
    await page.getByRole("button", { name: "Vystavit fakturu" }).click();
    await cekejNaUspech(page, "Faktura je vystavená");
    const faktura = await cekejNaFakturu(orderId);

    // Uživatel dobropis nevidí.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const tymStranka = await tym.newPage();
    await tymStranka.goto(`/objednavky?hledat=${cislo}`);
    await expect(tymStranka.getByRole("link", { name: faktura.number })).toBeVisible();
    await expect(tymStranka.getByRole("button", { name: "Dobropis" })).toHaveCount(0);

    // Dobropis s potvrzením.
    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${cislo}`,
      page.getByRole("button", { name: "Dobropis" }),
    );
    await page.getByRole("button", { name: "Dobropis" }).click();
    const okno = page.getByRole("dialog", { name: "Vystavit dobropis" });
    await expect(okno.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Vystavit dobropis" }).click(),
    ]);
    await cekejNaUspech(page, /Dobropis je vystavený: DB-/);

    // Uživatel zopakuje volání u jiné faktury — server ho odmítne.
    const jiny = await zalozKlientaSUctem(`Jiný dobropis ${pripona()}`);
    const jinaObjednavka = await zaplatProdukt(
      jiny.id,
      await zalozProdukt(`E2E Jiný ${pripona()}`),
    );
    const [jinaFaktura] = await dotaz<{ id: string }>(
      `INSERT INTO "invoices" ("id", "kind", "orderId", "taxableAt", "currency", "baseTotal",
                               "vatTotal", "total", "supplier", "customer", "items")
       VALUES (gen_random_uuid()::text, 'FAKTURA', $1, now(), 'CZK', 1000, 210, 1210,
               '{}'::jsonb, '{}'::jsonb, '[]'::jsonb) RETURNING "id"`,
      [jinaObjednavka],
    );
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: (akce.postData() ?? "").replace(faktura.id, jinaFaktura!.id),
    });
    const dobropisy = await dotaz(
      `SELECT 1 FROM "invoices" WHERE "orderId" = $1 AND "kind" = 'DOBROPIS'`,
      [jinaObjednavka],
    );
    expect(dobropisy).toHaveLength(0);
    await tym.close();
  });

  test("bez IČO firmy se faktura nevystaví a CRM na to upozorní", async ({ page }, info) => {
    // IČO je společné nastavení — souběžný prohlížeč by ho mezitím vrátil
    // (doma běží všechny tři naráz). Rozvržení hlídají ostatní testy.
    test.skip(info.project.name !== "desktop", "nastavení firmy je společné — jeden prohlížeč");
    await nastavFirmu(null);
    try {
      const klient = await zalozKlientaSUctem(`Bez IČO ${pripona()}`);
      const orderId = await zaplatProdukt(
        klient.id,
        await zalozProdukt(`E2E Bez IČO ${pripona()}`),
      );
      const [{ number: cislo }] = (await dotaz<{ number: string }>(
        `SELECT "number" FROM "orders" WHERE "id" = $1`,
        [orderId],
      )) as [{ number: string }];

      await otevriAzUvidis(
        page,
        `/objednavky?hledat=${cislo}`,
        page.getByRole("button", { name: "Vystavit fakturu" }),
      );
      await page.getByRole("button", { name: "Vystavit fakturu" }).click();
      await expect(
        page
          .locator("[data-sonner-toast]")
          .filter({ hasText: /Faktury jsou vypnuté/ })
          .first(),
      ).toBeVisible();
      expect(await dotaz(`SELECT 1 FROM "invoices" WHERE "orderId" = $1`, [orderId])).toHaveLength(
        0,
      );

      await page.goto("/objednavky/faktury");
      await expect(
        page.getByText(/Faktury jsou vypnuté — v Nastavení → Firma chybí: IČO/),
      ).toBeVisible();
    } finally {
      await nastavFirmu("12345678");
    }
  });

  test("seznam faktur a exporty CSV, Pohoda a ISDOC", { tag: "@telefon" }, async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Exportovaný ${pripona()}`);
    const orderId = await zaplatProdukt(klient.id, await zalozProdukt(`E2E Export ${pripona()}`));
    await page.goto(`/objednavky`);
    await page.getByRole("link", { name: "Faktury" }).click();
    await expect(page).toHaveURL(/\/objednavky\/faktury$/);

    // Fakturu vystaví administrátor ručně (objednávka zaplacená SQL).
    const [{ number: cislo }] = (await dotaz<{ number: string }>(
      `SELECT "number" FROM "orders" WHERE "id" = $1`,
      [orderId],
    )) as [{ number: string }];
    await otevriAzUvidis(
      page,
      `/objednavky?hledat=${cislo}`,
      page.getByRole("button", { name: "Vystavit fakturu" }),
    );
    await page.getByRole("button", { name: "Vystavit fakturu" }).click();
    const faktura = await cekejNaFakturu(orderId);

    await otevriAzUvidis(
      page,
      "/objednavky/faktury",
      page.getByTestId("faktura").filter({ hasText: faktura.number }),
    );
    await bezVodorovnehoPosuvu(page);

    const csv = await page.request.get("/objednavky/faktury/export?format=csv");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(faktura.number);

    const pohoda = await page.request.get("/objednavky/faktury/export?format=pohoda");
    const xml = await pohoda.text();
    expect(xml).toContain("<dat:dataPack");
    expect(xml).toContain(faktura.number);

    const isdoc = await page.request.get(`/objednavky/faktura/${faktura.id}/isdoc`);
    const dokument = await isdoc.text();
    expect(dokument).toContain('<Invoice xmlns="http://isdoc.cz/namespace/2013"');
    expect(dokument).toContain(faktura.number);
    // Ve faktuře ani exportu nejsou kontakty.
    expect(dokument).not.toContain("@");
    expect(xml).not.toContain(klient.email);
  });
});
