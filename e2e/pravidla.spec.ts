import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
} from "./pomocne";
import { zalozKlientaSUctem, zalozKurz, zalozProdukt, zaplatProdukt } from "./pomocne-klient";

/**
 * Pravidla „když se stane X, udělej Y“ (Fáze 5D, Jakub 18. 10. 2026).
 *
 * - Stránku Pravidla vidí každý přihlášený, mění jen administrátor
 *   (i přímé volání akce).
 * - Nechodí → zpráva, Odemčená lekce → oznámení: ranní plánovač,
 *   každá akce jen jednou; Nechodí znovu až po další návštěvě.
 * - Zaplaceno → štítek hned při zaplacení, po odebrání se nepřidá znovu.
 * - Nechodí → úkol „Ozvat se“ zaniklo 20. 10. 2026 (Jakub) — na stránce není.
 *
 * **Pravidla jsou společná pro celou testovací databázi**, proto testy
 * s plánovačem běží jen v jednom prohlížeči a po sobě, a pravidlo se po
 * testu vypne — jinak by se tři prohlížeče navzájem přepínaly.
 */

/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";
const MAILPIT = "http://mailpit:8025";

async function spustPlanovac(request: APIRequestContext) {
  const odpoved = await request.post("/api/planovac", {
    headers: { Authorization: `Bearer ${KLIC_PLANOVACE}`, "x-forwarded-for": nahodnaAdresa() },
  });
  expect(odpoved.status()).toBe(200);
}

async function nastavPravidlo(id: string, sloupce: Record<string, unknown>) {
  const klice = Object.keys(sloupce);
  await dotaz(
    `UPDATE "automation_rules" SET ${klice.map((k, i) => `"${k}" = $${i + 2}`).join(", ")}
     WHERE "id" = $1`,
    [id, ...Object.values(sloupce)],
  );
}

/** Platné členství a žádná návštěva = klient „nechodí“. */
async function nechodiciKlient(jmeno: string) {
  const klient = await zalozKlientaSUctem(jmeno);
  const produkt = await zalozProdukt(`E2E Členství pravidlo ${pripona()}`, "CLENSTVI");
  await dotaz(
    `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, now() + interval '30 days', now())`,
    [klient.id, produkt],
  );
  await dotaz(`UPDATE "client_accounts" SET "lastSeenAt" = NULL WHERE "clientId" = $1`, [
    klient.id,
  ]);
  return klient;
}

async function pocetEmailu(komu: string, predmet: string): Promise<number> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}" subject:"${predmet}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: unknown[] };
  return messages.length;
}

test.describe("pravidla — stránka", () => {
  test.describe("uživatel", () => {
    test.use({ storageState: stavPrihlaseni("uzivatel") });

    test(
      "vidí pravidla, měnit je nemůže ani přímým voláním",
      { tag: "@telefon" },
      async ({ page }) => {
        await page.goto("/pravidla");
        await expect(page.getByText("Nechodí → úkol", { exact: true })).toHaveCount(0);
        for (const nazev of [
          "Nechodí → zpráva klientovi",
          "Odemčená lekce → oznámení",
          "Zaplaceno → štítek",
        ]) {
          await expect(page.getByText(nazev, { exact: true })).toBeVisible();
        }
        await expect(page.getByRole("button", { name: "Uložit" })).toHaveCount(0);
        await expect(page.getByText("Zapnout a nastavit je může administrátor.")).toBeVisible();
        await bezVodorovnehoPosuvu(page);
      },
    );
  });
});

test.describe("pravidla — nastavení, plánovač a zaplacení", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: stavPrihlaseni("admin") });
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "pravidla jsou společná — jeden prohlížeč");
  });

  test("zapnout zprávu bez textu nejde; uživatel akci nezavolá", async ({ page, browser }) => {
    await page.goto("/pravidla");
    const karta = page.locator("[data-slot=card]", { hasText: "Nechodí → zpráva klientovi" });
    const formular = page.getByRole("form", { name: "Nastavení: Nechodí → zpráva klientovi" });
    await formular.getByLabel("Nadpis zprávy").fill("");
    await formular.getByLabel("Zapnuto").check();
    await formular.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Zpráva potřebuje nadpis i text.")).toBeVisible();
    await expect(karta.getByText("Vypnuto", { exact: true })).toBeVisible();

    // Platné uložení (vypnuté pravidlo) — stejné volání pak zkusí uživatel.
    const lekce = page.getByRole("form", { name: "Nastavení: Odemčená lekce → oznámení" });
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      lekce.getByRole("button", { name: "Uložit" }).click(),
    ]);
    await cekejNaUspech(page, "Vypnuto: Odemčená lekce → oznámení.");

    const uzivatel = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const pred = new Date();
    await uzivatel.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      data: akce.postDataBuffer()!,
    });
    await uzivatel.close();
    // Uživateli `requireAdmin()` nic neuloží — v auditu nepřibude ani řádek.
    const zmeny = await dotaz<{ role: string }>(
      `SELECT u."role" FROM "audit_log" a JOIN "users" u ON u."id" = a."userId"
       WHERE a."action" = 'pravidlo.zmeneno' AND a."at" >= $1`,
      [pred],
    );
    expect(zmeny.map((z) => z.role)).not.toContain("UZIVATEL");
  });

  test("Nechodí → zpráva jen jednou, znovu až po další návštěvě; úkol nevzniká", async ({
    request,
  }) => {
    const klient = await nechodiciKlient(`Nechodí Pravidlo ${pripona()}`);
    const pocty = async () => {
      // Pravidlo Nechodí → úkol „Ozvat se“ zaniklo 20. 10. 2026 (Jakub).
      const [radek] = await dotaz<{ ukoly: number; zpravy: number }>(
        `SELECT (SELECT count(*)::int FROM "tasks" WHERE "clientId" = $1) AS "ukoly",
                (SELECT count(*)::int FROM "client_messages" WHERE "clientId" = $1) AS "zpravy"`,
        [klient.id],
      );
      return radek!;
    };

    try {
      await nastavPravidlo("nechodi-zprava", { enabled: true });
      await spustPlanovac(request);
      await spustPlanovac(request);
      expect(await pocty()).toEqual({ ukoly: 0, zpravy: 1 });

      // Klient přišel a pak zase dlouho nechodil → nová epizoda.
      await dotaz(
        `UPDATE "client_accounts" SET "lastSeenAt" = now() - interval '40 days' WHERE "clientId" = $1`,
        [klient.id],
      );
      await spustPlanovac(request);
      expect(await pocty()).toEqual({ ukoly: 0, zpravy: 2 });
    } finally {
      await nastavPravidlo("nechodi-zprava", { enabled: false });
    }

    // Vypnuté pravidlo nedělá nic.
    await dotaz(
      `UPDATE "client_accounts" SET "lastSeenAt" = now() - interval '50 days' WHERE "clientId" = $1`,
      [klient.id],
    );
    await spustPlanovac(request);
    expect(await pocty()).toEqual({ ukoly: 0, zpravy: 2 });
  });

  test("Odemčená lekce → jedno oznámení (e-mailem bez telefonu)", async ({ request }) => {
    const klient = await zalozKlientaSUctem(`Lekce Pravidlo ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz pravidlo ${pripona()}`);
    const kurzId = await zalozKurz(produkt, `Pravidlový ${pripona()}`, ["Hned", "Dnes ráno"]);
    await zaplatProdukt(klient.id, produkt);
    await dotaz(
      `UPDATE "course_lessons" SET "unlockOn" = now() - interval '1 hour'
       WHERE "courseId" = $1 AND "title" = 'Dnes ráno'`,
      [kurzId],
    );

    try {
      await nastavPravidlo("lekce-oznameni", { enabled: true });
      await spustPlanovac(request);
      await spustPlanovac(request);
    } finally {
      await nastavPravidlo("lekce-oznameni", { enabled: false });
    }
    await expect
      .poll(() => pocetEmailu(klient.email, "Otevřela se vám nová lekce"), { timeout: 20_000 })
      .toBe(1);
    const [provedeno] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "automation_runs"
       WHERE "ruleId" = 'lekce-oznameni' AND "clientId" = $1`,
      [klient.id],
    );
    expect(provedeno!.pocet).toBe(1);
  });

  test("Zaplaceno → dva kurzy dají dva štítky; odebraný se nevrátí", async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Štítek Pravidlo ${pripona()}`);
    const kurzA = await zalozProdukt(`E2E Štítkový A ${pripona()}`);
    const kurzB = await zalozProdukt(`E2E Štítkový B ${pripona()}`);
    const stitek = async (nazev: string) =>
      (
        await dotaz<{ id: string }>(
          `INSERT INTO "client_tags" ("id", "name", "color", "updatedAt")
           VALUES ($1, $2, 'ZNACKA'::"TagColor", now()) RETURNING "id"`,
          [`e2estitek${pripona()}${pripona()}`, `${nazev} ${pripona()}`],
        )
      )[0]!.id;
    const stitekA = await stitek("Koupil A");
    const stitekB = await stitek("Koupil B");
    const [objednavka] = await dotaz<{ id: string; number: string }>(
      `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, 'Test', $1, 'NOVA', 'CZK', now(), now())
       RETURNING "id", "number"`,
      [klient.id],
    );
    for (const produkt of [kurzA, kurzB]) {
      await dotaz(
        `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
         VALUES (gen_random_uuid()::text, $1, $2, 1)`,
        [objednavka!.id, produkt],
      );
    }
    const stitkyKlienta = async () =>
      (
        await dotaz<{ tagId: string }>(
          `SELECT "tagId" FROM "client_tag_links" WHERE "clientId" = $1 ORDER BY "tagId"`,
          [klient.id],
        )
      ).map((radek) => radek.tagId);
    const prepni = async (stav: RegExp) => {
      await otevriAzUvidis(
        page,
        `/objednavky?hledat=${encodeURIComponent(objednavka!.number)}`,
        page.getByText(objednavka!.number, { exact: true }).first(),
      );
      await vyber(page, "Změnit stav objednávky", stav);
      await cekejNaUspech(page, /Stav objednávky je změněný/);
    };

    try {
      await dotaz(
        `INSERT INTO "automation_tag_pairs" ("id", "productId", "tagId")
         VALUES (gen_random_uuid()::text, $1, $2), (gen_random_uuid()::text, $3, $4)`,
        [kurzA, stitekA, kurzB, stitekB],
      );
      await nastavPravidlo("zaplaceno-stitek", { enabled: true });
      await prepni(/^Zaplaceno$/);
      expect(await stitkyKlienta()).toEqual([stitekA, stitekB].sort());

      // Kolega štítek A odebere; další zaplacení ho nevrátí, B zůstane.
      await dotaz(`DELETE FROM "client_tag_links" WHERE "clientId" = $1 AND "tagId" = $2`, [
        klient.id,
        stitekA,
      ]);
      await prepni(/^Nová objednávka$/);
      await prepni(/^Zaplaceno$/);
      expect(await stitkyKlienta()).toEqual([stitekB]);
    } finally {
      await nastavPravidlo("zaplaceno-stitek", { enabled: false });
      await dotaz(`DELETE FROM "automation_tag_pairs" WHERE "productId" IN ($1, $2)`, [
        kurzA,
        kurzB,
      ]);
    }
  });
});
