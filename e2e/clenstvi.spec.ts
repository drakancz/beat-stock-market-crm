import { expect, test, type Page } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, pripona, stavPrihlaseni } from "./pomocne";
import { zalozKlientaSUctem, zalozProdukt } from "./pomocne-klient";

/**
 * Čísla členství na Dashboardu (Jakub, 10. 10. 2026).
 *
 * - vidí je každý přihlášený (oddíl na Dashboardu),
 * - prodloužení = další platba nejpozději 14 dní po konci; pozdější platba
 *   je návrat a předchozí konec se počítá jako odchod,
 * - noví členové = první platba za členství v období.
 *
 * Ostatní testy souběžně zakládají vlastní členství, takže přesná čísla se
 * ověřují **ve vlastním roce daleko v minulosti** — každý prohlížeč má svůj
 * rok, aby se běhy ve třech prohlížečích nesčítaly.
 */

const ROK_PROHLIZECE: Record<string, number> = { desktop: 2001, android: 2002, iphone: 2003 };

/** Zaplacená objednávka s daným dnem zaplacení (poledne v Praze). */
async function zaplatDne(clientId: string, productId: string, den: string) {
  const [objednavka] = await dotaz<{ id: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'ZAPLACENO', 'CZK',
             ($2::date + time '12:00') AT TIME ZONE 'Europe/Prague',
             ($2::date + time '12:00') AT TIME ZONE 'Europe/Prague', now())
     RETURNING "id"`,
    [clientId, den],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, productId],
  );
}

/** Jedno číslo v oddílu Členství (popisek, hodnota, vysvětlivka). */
function udaj(page: Page, titulek: string) {
  return page
    .locator('dl[aria-label="Čísla členství"] > div')
    .filter({ has: page.getByText(titulek, { exact: true }) });
}

/** Samotná hodnota (velké číslo) u daného popisku. */
function hodnota(page: Page, titulek: string) {
  return udaj(page, titulek).locator("dd").first();
}

test.describe("čísla členství", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "prodloužení do 14 dní, odchody a noví členové za období",
    { tag: "@telefon" },
    async ({ page }, info) => {
      const rok = ROK_PROHLIZECE[info.project.name] ?? 2004;
      const produkt = await zalozProdukt(`E2E Členství měsíc ${pripona()}`, "CLENSTVI");
      await dotaz(`UPDATE "products" SET "validityMonths" = 1 WHERE "id" = $1`, [produkt]);

      // A: konec 1. 4., zaplatil 10. 4. (do 14 dní) = prodloužení;
      //    nový konec 10. 5. bez další platby = odchod.
      const a = await zalozKlientaSUctem(`Člen Včas ${pripona()}`);
      await zaplatDne(a.id, produkt, `${rok}-03-01`);
      await zaplatDne(a.id, produkt, `${rok}-04-10`);

      // B: konec 1. 7., zaplatil až 1. 8. (po lhůtě) = odchod a návrat;
      //    konec 1. 9. bez další platby = odchod.
      const b = await zalozKlientaSUctem(`Člen Pozdě ${pripona()}`);
      await zaplatDne(b.id, produkt, `${rok}-06-01`);
      await zaplatDne(b.id, produkt, `${rok}-08-01`);

      await page.goto(`/dashboard?obdobi=vlastni&od=${rok}-01-01&do=${rok}-12-31`);
      await expect(page.locator('dl[aria-label="Čísla členství"]')).toBeVisible();

      await expect(hodnota(page, "Míra prodloužení")).toHaveText("25 %");
      await expect(udaj(page, "Míra prodloužení")).toContainText("prodloužilo 1 z 4");
      await expect(hodnota(page, "Odešli")).toHaveText("3");
      await expect(hodnota(page, "Noví členové")).toHaveText("2");

      // Rok bez členství: nic neskončilo, nikdo nový.
      await page.goto(`/dashboard?obdobi=vlastni&od=${rok + 10}-01-01&do=${rok + 10}-12-31`);
      await expect(hodnota(page, "Míra prodloužení")).toHaveText("—");
      await expect(udaj(page, "Míra prodloužení")).toContainText(
        "v období žádné členství neskončilo",
      );
      await expect(hodnota(page, "Noví členové")).toHaveText("0");
      await bezVodorovnehoPosuvu(page);
    },
  );

  test("aktivní člen se počítá do členů a měsíčního příjmu", async ({ page }) => {
    await page.goto("/dashboard");
    const predtim = Number((await hodnota(page, "Aktivní členové").textContent())?.trim());

    // Roční členství za 1 200 Kč bez DPH = 100 Kč měsíčně, zaplacené dnes.
    const produkt = await zalozProdukt(`E2E Členství rok ${pripona()}`, "CLENSTVI");
    await dotaz(`UPDATE "products" SET "netPrice" = 1200 WHERE "id" = $1`, [produkt]);
    const klient = await zalozKlientaSUctem(`Člen Aktivní ${pripona()}`);
    await zaplatDne(klient.id, produkt, new Date().toISOString().slice(0, 10));
    await dotaz(
      `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, now() + interval '300 days', now())`,
      [klient.id, produkt],
    );

    await page.reload();
    // Ostatní testy můžou členy přidávat souběžně — aspoň o jednoho víc.
    await expect(async () => {
      await page.reload();
      const ted = Number((await hodnota(page, "Aktivní členové").textContent())?.trim());
      expect(ted).toBeGreaterThan(predtim);
    }).toPass({ timeout: 60_000 });
    await expect(udaj(page, "Měsíční příjem z členství")).toContainText("Kč");
  });
});
