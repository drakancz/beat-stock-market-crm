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
} from "./pomocne-klient";

/**
 * Aktivita klienta a „platí, ale nechodí“ (Fáze 5B, Jakub 15. 10. 2026).
 *
 * - **Nechodí** = běží členství a poslední návštěva klientské části
 *   i poslední zaplacení jsou starší než hranice z Nastavení (výchozí 21 dní).
 * - Čerstvě zaplacený, nedávno aktivní a kupec kurzu bez členství značku nemají.
 * - Vidí každý přihlášený; hranici mění jen administrátor.
 *
 * Hranice jde nastavit na 7–180 dní a jiný test ji mezitím může měnit,
 * proto „starý“ člen je mimo 180 dní a „čerství“ v posledním dni.
 */

/** Člen s účtem: zaplaceno a naposledy v klientské části před tolika dny. */
async function zalozClena(
  jmeno: string,
  {
    platbaPred,
    navstevaPred,
    clenstvi = true,
  }: {
    platbaPred: number;
    navstevaPred: number | null;
    clenstvi?: boolean;
  },
) {
  const klient = await zalozKlientaSUctem(jmeno);
  const produkt = await zalozProdukt(
    `E2E ${clenstvi ? "Členství" : "Kurz"} ${pripona()}`,
    clenstvi ? "CLENSTVI" : "KURZ",
  );
  const [objednavka] = await dotaz<{ id: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'ZAPLACENO', 'CZK',
             now() - make_interval(days => $2), now() - make_interval(days => $2), now())
     RETURNING "id"`,
    [klient.id, platbaPred],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, produkt],
  );
  if (clenstvi) {
    await dotaz(
      `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, now() + interval '100 days', now())`,
      [klient.id, produkt],
    );
  }
  await dotaz(
    `UPDATE "client_accounts"
        SET "lastSeenAt" = CASE WHEN $2::int IS NULL THEN NULL
                                ELSE now() - make_interval(days => $2::int) END
      WHERE "clientId" = $1`,
    [klient.id, navstevaPred],
  );
  return klient;
}

test.describe("platí, ale nechodí", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "značka a filtr jen u člena, který dlouho nechodí",
    { tag: "@telefon" },
    async ({ page }) => {
      const znacka = `Nechodi ${pripona()}`;
      const stary = await zalozClena(`${znacka} Stary`, { platbaPred: 400, navstevaPred: 200 });
      await zalozClena(`${znacka} Cerstvy`, { platbaPred: 0, navstevaPred: null });
      await zalozClena(`${znacka} Aktivni`, { platbaPred: 400, navstevaPred: 0 });
      await zalozClena(`${znacka} Kurz`, { platbaPred: 400, navstevaPred: null, clenstvi: false });

      // Bez filtru: značku má jen starý člen.
      await page.goto(`/klienti?hledat=${encodeURIComponent(znacka)}`);
      const radky = page.getByRole("row").filter({ hasText: znacka });
      await expect(radky).toHaveCount(4);
      await expect(radky.filter({ hasText: "Nechodí" })).toHaveCount(1);
      await expect(radky.filter({ hasText: "Nechodí" })).toContainText(`${znacka} Stary`);
      await bezVodorovnehoPosuvu(page);

      // Filtr Aktivita: jen on.
      await page.goto(`/klienti?aktivita=NECHODI&hledat=${encodeURIComponent(znacka)}`);
      await expect(radky).toHaveCount(1);
      await expect(radky).toContainText(`${znacka} Stary`);
      await expect(page.getByRole("combobox", { name: "Aktivita" })).toContainText(
        "Platí, ale nechodí",
      );

      // Karta: poslední návštěva, aktivita a značka.
      await page.goto(`/klienti/${stary.id}`);
      await expect(page.getByText("Naposledy v klientské části")).toBeVisible();
      await expect(page.getByText("Dokončené lekce za 30 dní")).toBeVisible();
      await expect(page.getByText(/Platí členství, ale přes \d+ dní bez návštěvy/)).toBeVisible();
    },
  );

  test("návštěva klientské části zapíše čas", { tag: "@telefon" }, async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Navsteva ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await stranka.goto("/ucet");

    await expect
      .poll(async () => {
        const [ucet] = await dotaz<{ lastSeenAt: Date | null }>(
          `SELECT "lastSeenAt" FROM "client_accounts" WHERE "clientId" = $1`,
          [klient.id],
        );
        return ucet?.lastSeenAt ?? null;
      })
      .not.toBeNull();
    await stranka.context().close();
  });
});

test.describe("hranice v Nastavení", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor hranici změní, uživatel ne", async ({ page, browser }) => {
    test.skip(test.info().project.name !== "desktop", "Jedno nastavení pro celou firmu.");

    const pole = page.getByLabel("Po kolika dnech bez návštěvy");
    await otevriAzUvidis(page, "/nastaveni/prodlouzeni", pole);
    const ulozit = page
      .locator("form")
      .filter({ has: pole })
      .getByRole("button", { name: "Uložit" });

    await pole.fill("3");
    // Prohlížeč pod 7 nepustí, server taky ne — zkouší se serverová kontrola.
    await pole.evaluate((prvek) => prvek.removeAttribute("min"));
    await ulozit.click();
    await cekejNaUspech(page, /Míň než týden nejde/);

    await pole.fill("30");
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      ulozit.click(),
    ]);
    await cekejNaUspech(page, /Značku Nechodí dostane člen po 30 dnech/);

    // Uživatel stejnou akci napřímo nezavolá.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      data: (akce.postData() ?? "").replace(/(name="inactiveMemberDays"\r\n\r\n)30/, "$1150"),
    });
    await tym.close();
    const [nastaveni] = await dotaz<{ inactiveMemberDays: number }>(
      `SELECT "inactiveMemberDays" FROM "company_settings" WHERE "id" = 'firma'`,
    );
    expect(nastaveni?.inactiveMemberDays, "uživatel nesmí hranici změnit").toBe(30);

    // Zpátky na výchozí.
    await pole.fill("21");
    await ulozit.click();
    await cekejNaUspech(page, /po 21 dnech/);
  });
});
