import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  cekejNaZmizeniUpozorneni,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import { zalozKlientaSUctem, zalozProdukt, zaplatProdukt } from "./pomocne-klient";

/**
 * Konzultace v Google Kalendáři (Jakub, 20. 10. 2026).
 *
 * | Kdo           | Smí                                                     |
 * | ------------- | ------------------------------------------------------- |
 * | administrátor | připojit a odpojit kalendář, zapsat budoucí rezervace   |
 * | uživatel      | nic — Nastavení → Kalendář je 404, ani přímým voláním   |
 * | nepřihlášený  | nic                                                     |
 *
 * Aplikace mluví s napodobeninou Googlu v kontejneru
 * (`e2e/napodobenina-google-kalendare.mjs`) — ven nic neodchází.
 * V události nesmí být e-mail ani telefon klienta.
 *
 * Napojení je jedno pro celou testovací databázi, proto testy, které ho
 * mění, běží jen na desktopu a po sobě; na konci se zase vypne.
 */

const NAPODOBENINA = "http://localhost:3196";
const TELEFON = "+420 601 234 567";

interface Udalost {
  id: string;
  status: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string };
}

async function udalosti(kalendar: string): Promise<Udalost[]> {
  const odpoved = await fetch(
    `${NAPODOBENINA}/test/udalosti?kalendar=${encodeURIComponent(kalendar)}`,
  );
  return (await odpoved.json()) as Udalost[];
}

async function udalostKlienta(kalendar: string, jmeno: string) {
  return (await udalosti(kalendar)).find((u) => u.summary === `Konzultace – ${jmeno}`);
}

/** Termín za `zaHodin` hodin s jedinečným místem. */
async function zalozTermin(zaHodin: number, misto: string) {
  await dotaz(
    `INSERT INTO "consultation_slots" ("id", "startsAt", "durationMinutes", "place", "updatedAt")
     VALUES ($1, now() + make_interval(hours => $2), 60, $3, now())`,
    [`e2ekal${pripona()}${pripona()}`, zaHodin, misto],
  );
}

/** Klient se zaplacenou konzultací a telefonem (aby šlo ověřit, že neodejde). */
async function klientSKonzultaci(jmeno: string) {
  const klient = await zalozKlientaSUctem(jmeno);
  await dotaz(`UPDATE "clients" SET "phone" = $1 WHERE "id" = $2`, [TELEFON, klient.id]);
  const produkt = await zalozProdukt(`E2E Konzultace ${pripona()}`, "KONZULTACE");
  await zaplatProdukt(klient.id, produkt);
  return klient;
}

/** Zarezervuje termín klientovi přes CRM (Konzultace → Zarezervovat klientovi). */
async function zarezervujKlientovi(page: Page, misto: string, jmeno: string) {
  const radek = page.getByTestId("termin-konzultace").filter({ hasText: misto });
  await otevriAzUvidis(page, "/konzultace", radek);
  await radek.getByRole("button", { name: "Zarezervovat klientovi" }).click();
  const okno = page.getByRole("dialog", { name: "Zarezervovat klientovi" });
  await okno.getByRole("combobox", { name: "Vyber klienta" }).click();
  await page.getByRole("combobox", { name: "Hledat klienta…" }).fill(jmeno);
  await page.getByRole("option", { name: jmeno }).click();
  await okno.getByRole("button", { name: "Zarezervovat", exact: true }).click();
  await cekejNaUspech(page, `Zarezervováno: ${jmeno}`);
  return radek;
}

async function nastavKalendar(kalendar: string | null, zapnuto: boolean) {
  await dotaz(
    `UPDATE "company_settings" SET "googleCalendarId" = $1, "googleCalendarActive" = $2
      WHERE "id" = 'firma'`,
    [kalendar, zapnuto],
  );
}

async function otevreneChybyKalendare(od: Date) {
  const [radek] = await dotaz<{ pocet: number }>(
    `SELECT count(*)::int AS "pocet" FROM "integration_errors"
      WHERE "kind" = 'kalendar.zapis' AND "resolvedAt" IS NULL AND "lastAt" >= $1`,
    [od],
  );
  return radek!.pocet;
}

test.describe("Google Kalendář — administrátor", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: stavPrihlaseni("admin") });
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "napojení je společné — jeden prohlížeč");
  });
  test.afterAll(async ({}, info) => {
    if (info.project.name === "desktop") await nastavKalendar(null, false);
  });

  test("připojí kalendář; rezervace zapíše událost bez kontaktů, zrušení ji smaže; uživatel nic nezmění", async ({
    page,
    browser,
  }) => {
    const kalendar = `firma-${pripona()}@example.test`;
    await page.goto("/nastaveni/kalendar");
    await expect(page.getByTestId("servisni-ucet")).toContainText("gserviceaccount.com");
    await expect(page.getByText("Vypnuto", { exact: true })).toBeVisible();

    // Kalendář, ke kterému se CRM nedostane, zapnout nejde.
    await page.getByLabel("ID firemního kalendáře").fill("neexistuje@example.test");
    await page.getByLabel("Zapisovat rezervace konzultací do kalendáře").check();
    await page.getByRole("button", { name: "Uložit" }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Kalendář se nenašel" }),
    ).toBeVisible();

    await page.getByLabel("ID firemního kalendáře").fill(kalendar);
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      page.getByRole("button", { name: "Uložit" }).click(),
    ]);
    await cekejNaUspech(page, "Kalendář je připojený");
    await expect(page.getByText("Zapnuto", { exact: true })).toBeVisible();
    await cekejNaZmizeniUpozorneni(page);
    await page.getByRole("button", { name: "Vyzkoušet spojení" }).click();
    await cekejNaUspech(page, "Spojení s kalendářem funguje.");

    // Uživatel zopakuje uložení s jiným kalendářem — server ho odmítne.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      data: (akce.postData() ?? "").replace(kalendar, "podvrh@example.test"),
    });
    await tym.close();
    const [ulozeny] = await dotaz<{ googleCalendarId: string }>(
      `SELECT "googleCalendarId" FROM "company_settings" WHERE "id" = 'firma'`,
    );
    expect(ulozeny!.googleCalendarId, "uživatel nesmí změnit kalendář").toBe(kalendar);

    // Rezervace → událost se jménem, časem a místem, bez e-mailu a telefonu.
    const misto = `Kalendář ${pripona()}`;
    await zalozTermin(50, misto);
    const klient = await klientSKonzultaci(`Kalendářový ${pripona()}`);
    const radek = await zarezervujKlientovi(page, misto, klient.name);

    await expect
      .poll(async () => (await udalostKlienta(kalendar, klient.name))?.status, { timeout: 20_000 })
      .toBe("confirmed");
    const udalost = (await udalostKlienta(kalendar, klient.name))!;
    expect(udalost.location).toBe(misto);
    const text = JSON.stringify(udalost);
    expect(text, "v události nesmí být e-mail").not.toContain(klient.email);
    expect(text, "v události nesmí být e-mail").not.toContain("@");
    expect(text, "v události nesmí být telefon").not.toContain("601 234 567");

    // Zrušení rezervace událost smaže.
    await cekejNaZmizeniUpozorneni(page);
    await radek.getByRole("button", { name: "Zrušit rezervaci" }).click();
    const zrusit = page.getByRole("dialog", { name: "Zrušit rezervaci" });
    await zrusit.getByRole("button", { name: "Zrušit rezervaci" }).click();
    await cekejNaUspech(page, `Rezervace je zrušená: ${klient.name}.`);
    await expect
      .poll(async () => (await udalostKlienta(kalendar, klient.name))?.status, { timeout: 20_000 })
      .toBe("cancelled");
  });

  test("výpadek Googlu rezervaci neshodí; „Zapsat budoucí rezervace“ ji dopíše", async ({
    page,
  }) => {
    const od = new Date();
    const kalendar = `firma-${pripona()}@example.test`;
    await nastavKalendar(`vypadek-${kalendar}`, true);

    const misto = `Výpadek ${pripona()}`;
    await zalozTermin(52, misto);
    const klient = await klientSKonzultaci(`Výpadkový ${pripona()}`);
    const radek = await zarezervujKlientovi(page, misto, klient.name);
    await expect(radek.getByText(klient.name)).toBeVisible();
    await expect.poll(() => otevreneChybyKalendare(od), { timeout: 20_000 }).toBeGreaterThan(0);

    // Google zase odpovídá — administrátor dopíše budoucí rezervace.
    await nastavKalendar(kalendar, true);
    await page.goto("/nastaveni/kalendar");
    await page.getByRole("button", { name: "Zapsat budoucí rezervace" }).click();
    await cekejNaUspech(page, /Zapsané budoucí rezervace: \d+/);
    expect((await udalostKlienta(kalendar, klient.name))?.status).toBe("confirmed");

    // Vypnutí z obrazovky.
    await cekejNaZmizeniUpozorneni(page);
    await page.getByLabel("Zapisovat rezervace konzultací do kalendáře").uncheck();
    await page.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Napojení na kalendář je vypnuté.");
    await expect(page.getByText("Vypnuto", { exact: true })).toBeVisible();
  });
});

test.describe("Google Kalendář — obrazovka", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("na telefonu nic nepřečnívá", { tag: "@telefon" }, async ({ page }) => {
    await page.goto("/nastaveni/kalendar");
    await expect(page.getByRole("button", { name: "Zapsat budoucí rezervace" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});

test.describe("Google Kalendář — uživatel a nepřihlášený", () => {
  test("uživatel dostane 404", async ({ browser }) => {
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await tym.newPage();
    const odpoved = await page.goto("/nastaveni/kalendar");
    expect(odpoved?.status()).toBe(404);
    await tym.close();
  });

  test("nepřihlášeného pošle na přihlášení", async ({ page }) => {
    await page.goto("/nastaveni/kalendar");
    await expect(page).toHaveURL(/\/prihlaseni/);
  });
});
