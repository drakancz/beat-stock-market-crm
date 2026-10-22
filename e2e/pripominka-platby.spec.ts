import { expect, test } from "@playwright/test";

import {
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
} from "./pomocne";
import { zalozKlientaSUctem, zalozProdukt } from "./pomocne-klient";

/**
 * Připomínka nezaplacené objednávky (Fáze 5A, Jakub 11. 10. 2026).
 *
 * - Ranní plánovač pošle klientovi připomínku po 3 a po 7 dnech od
 *   objednávky; s druhou vznikne úkol „Nezaplaceno: …“. Zaplacená ani
 *   smazaná objednávka připomínku nedostane, dvojí spuštění nic nezdvojí.
 * - V testech nejsou klíče k oznámením, připomínka jde e-mailem do Mailpitu.
 * - Po zaplacení se úkol sám odškrtne.
 * - **Nastavuje jen administrátor**, uživatel dostane 404. Že připomínka
 *   odešla, vidí u objednávky každý přihlášený.
 *
 * Nastavení je jedno pro celou firmu a testy běží ve třech prohlížečích
 * najednou — úkol proto jde vždy zkušebnímu administrátorovi a dny zůstávají
 * výchozí (3 a 7), ať se běhy navzájem nepřepisují.
 */

const MAILPIT = "http://mailpit:8025";
/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

async function predmetyEmailu(komu: string): Promise<{ Subject: string; Text: string }[]> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()),
  );
}

/** Objednávka `dnuZpet` pražských dnů stará, s jednou položkou. Vrací id a číslo. */
async function zalozObjednavku(
  clientId: string,
  productId: string,
  dnuZpet: number,
  stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO",
  smazana = false,
) {
  const [objednavka] = await dotaz<{ id: string; number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt", "deletedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, $2::"OrderStatus", 'CZK',
             CASE WHEN $2 = 'ZAPLACENO' THEN now() END,
             (date_trunc('day', now() AT TIME ZONE 'Europe/Prague')
                - make_interval(days => $3) + interval '10 hours') AT TIME ZONE 'Europe/Prague',
             now(), CASE WHEN $4 THEN now() END)
     RETURNING "id", "number"`,
    [clientId, stav, dnuZpet, smazana],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, productId],
  );
  return objednavka!;
}

/** Zapnuté připomínky s výchozími dny. */
async function nastavPripominky() {
  await dotaz(
    `INSERT INTO "company_settings" ("id", "paymentRemindersEnabled", "paymentReminderFirstDays",
                                     "paymentReminderSecondDays", "updatedAt")
     VALUES ('firma', true, 3, 7, now())
     ON CONFLICT ("id") DO UPDATE SET "paymentRemindersEnabled" = true,
       "paymentReminderFirstDays" = 3, "paymentReminderSecondDays" = 7`,
  );
}

test.describe("připomínka nezaplacené objednávky", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("plánovač připomene po 3 a 7 dnech, úkol zavolat nevznikne", async ({ page, request }) => {
    await nastavPripominky();
    const produkt = await zalozProdukt(`E2E Platba ${pripona()}`);
    const prvni = await zalozKlientaSUctem(`Platba Čtyři ${pripona()}`);
    const druha = await zalozKlientaSUctem(`Platba Osm ${pripona()}`);
    const zaplacena = await zalozKlientaSUctem(`Platba Zaplaceno ${pripona()}`);
    const smazana = await zalozKlientaSUctem(`Platba Smazáno ${pripona()}`);
    const cerstva = await zalozKlientaSUctem(`Platba Dnes ${pripona()}`);

    const objPrvni = await zalozObjednavku(prvni.id, produkt, 4, "NEZAPLACENO");
    const objDruha = await zalozObjednavku(druha.id, produkt, 8, "NOVA");
    await zalozObjednavku(zaplacena.id, produkt, 8, "ZAPLACENO");
    await zalozObjednavku(smazana.id, produkt, 8, "NEZAPLACENO", true);
    await zalozObjednavku(cerstva.id, produkt, 1, "NOVA");

    const spust = () =>
      request.post("/api/planovac", {
        headers: { Authorization: `Bearer ${KLIC_PLANOVACE}`, "x-forwarded-for": nahodnaAdresa() },
      });
    expect((await spust()).status()).toBe(200);

    // E-mail s číslem objednávky a částkou s DPH.
    for (const [klient, cislo] of [
      [prvni, objPrvni.number],
      [druha, objDruha.number],
    ] as const) {
      await expect(async () => {
        const emaily = await predmetyEmailu(klient.email);
        const email = emaily.find((e) => e.Subject === "Objednávka čeká na zaplacení");
        expect(email?.Text).toContain(cislo);
        expect(email?.Text).toMatch(/K úhradě: .* včetně DPH/);
      }).toPass({ timeout: 20_000 });
    }

    // Druhé spuštění nic nezdvojí; zaplacená, smazaná a čerstvá nic nedostanou.
    expect((await spust()).status()).toBe(200);
    await new Promise((hotovo) => setTimeout(hotovo, 2_000));
    expect(await predmetyEmailu(prvni.email)).toHaveLength(1);
    expect(await predmetyEmailu(druha.email)).toHaveLength(1);
    for (const klient of [zaplacena, smazana, cerstva]) {
      expect(await predmetyEmailu(klient.email)).toHaveLength(0);
    }

    const [stav] = await dotaz<{ prvni: number; druha: number; ukoly: number }>(
      `SELECT (SELECT "paymentReminders" FROM "orders" WHERE "id" = $1) AS "prvni",
              (SELECT "paymentReminders" FROM "orders" WHERE "id" = $2) AS "druha",
              (SELECT count(*)::int FROM "tasks" WHERE "clientId" = $3) AS "ukoly"`,
      [objPrvni.id, objDruha.id, druha.id],
    );
    // Úkol zavolat s druhou připomínkou zanikl 20. 10. 2026 (Jakub).
    expect(stav).toMatchObject({ prvni: 1, druha: 2, ukoly: 0 });

    // V Objednávkách je vidět, že se připomínalo.
    await otevriAzUvidis(
      page,
      `/objednavky?klient=${druha.id}`,
      page.getByText(/Připomenuto .* \(2×\), e-mailem/),
    );

    // Po zaplacení připomínka u objednávky zmizí.
    await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
    await cekejNaUspech(page, /Stav objednávky je změněný/);
    await expect(page.getByText(/Připomenuto/)).toHaveCount(0);
  });

  test("administrátor připomínky nastaví, nesmyslné dny se odmítnou", async ({ page }) => {
    await nastavPripominky();
    await page.goto("/nastaveni/prodlouzeni");
    await expect(page.getByText("Připomínka nezaplacené objednávky")).toBeVisible();
    await expect(page.getByLabel("Úkol zavolat dostane")).toHaveCount(0);

    await page.getByLabel("První připomínka po (dnech)").fill("7");
    await page.getByLabel("Druhá připomínka po (dnech)").fill("3");
    await page.getByRole("button", { name: "Uložit připomínky" }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Druhá připomínka musí přijít později" }),
    ).toBeVisible();

    // Stejné hodnoty, jaké už jsou — ostatní souběžné běhy počítají s 3 a 7.
    await page.getByLabel("První připomínka po (dnech)").fill("3");
    await page.getByLabel("Druhá připomínka po (dnech)").fill("7");
    await page.getByRole("button", { name: "Uložit připomínky" }).click();
    await cekejNaUspech(page, /Připomínky platby jsou uložené|Nic se nezměnilo/);
  });
});

test.describe("připomínka platby očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("nastavení nevidí (404), že se připomínalo, ano", async ({ page }) => {
    const odpoved = await page.goto("/nastaveni/prodlouzeni");
    expect(odpoved?.status()).toBe(404);

    const klient = await zalozKlientaSUctem(`Platba Tým ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Platba tým ${pripona()}`);
    const objednavka = await zalozObjednavku(klient.id, produkt, 4, "NEZAPLACENO");
    // Připomínka zapsaná rovnou — klient bez povolených oznámení, e-mail neodešel.
    await dotaz(
      `UPDATE "orders" SET "paymentReminders" = 1, "paymentRemindedAt" = now(),
              "paymentReminderDelivery" = 'BEZ_UCTU' WHERE "id" = $1`,
      [objednavka.id],
    );
    await otevriAzUvidis(
      page,
      `/objednavky?klient=${klient.id}`,
      page.getByText(/Připomenuto .* \(1×\), nedoručeno — klient nemá účet/),
    );
  });
});
