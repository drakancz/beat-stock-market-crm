import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, otevriAzUvidis, pripona, stavPrihlaseni } from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";
import { STITEK_TELEFON } from "./telefon";

/**
 * Moje údaje ke stažení (Jakub, 21. 10. 2026) — kopie údajů pro klienta
 * (GDPR) v PDF a JSON.
 *
 * Co se tu hlídá:
 *
 * - **Stáhne jen přihlášený klient a jen sebe.** Tým ani nepřihlášený
 *   soubor nedostane.
 * - **Interní věci týmu v souboru nejsou** — poznámky, štítky, úkoly —
 *   ani heslo a nic o jiném klientovi.
 * - Stažení se zapíše do auditu a počet za hodinu je omezený.
 */

test.describe("klient", () => {
  test(
    "v Mém profilu stáhne PDF, karta se vejde na obrazovku",
    { tag: STITEK_TELEFON },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Klient Údaje ${pripona()}`);
      const stranka = await prohlizecKlienta(browser);
      await prihlasKlienta(stranka, klient.email, klient.heslo);

      await otevriAzUvidis(stranka, "/ucet/profil", stranka.getByText("Moje údaje ke stažení"));
      await bezVodorovnehoPosuvu(stranka);

      const stahovani = stranka.waitForEvent("download");
      await stranka.getByRole("link", { name: "Stáhnout (PDF)" }).click();
      const soubor = await stahovani;
      expect(soubor.suggestedFilename()).toMatch(/^moje-udaje-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(
        readFileSync((await soubor.path())!)
          .subarray(0, 4)
          .toString(),
      ).toBe("%PDF");

      await stranka.context().close();
    },
  );

  test("JSON nese jeho údaje, ale ne interní věci týmu ani cizího klienta", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Údaje ${pripona()}`);
    const cizi = await zalozKlientaSUctem(`Cizí Klient ${pripona()}`);
    const produkt = `Kurz Údaje ${pripona()}`;
    await zaplatProdukt(klient.id, await zalozProdukt(produkt));

    const zprava = `Zpráva pro klienta ${pripona()}`;
    const poznamka = `INTERNI-POZNAMKA-${pripona()}`;
    const stitek = `E2E-STITEK-${pripona()}`;
    const ukol = `INTERNI-UKOL-${pripona()}`;
    const [kolega] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "users" WHERE "deletedAt" IS NULL LIMIT 1`,
    );
    await dotaz(
      `INSERT INTO "client_messages" ("id", "clientId", "text", "delivery")
       VALUES (gen_random_uuid()::text, $1, $2, 'JEN_UCET')`,
      [klient.id, zprava],
    );
    await dotaz(
      `INSERT INTO "client_notes" ("id", "clientId", "authorId", "text", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now())`,
      [klient.id, kolega!.id, poznamka],
    );
    const [tag] = await dotaz<{ id: string }>(
      `INSERT INTO "client_tags" ("id", "name", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, now()) RETURNING "id"`,
      [stitek],
    );
    await dotaz(`INSERT INTO "client_tag_links" ("clientId", "tagId") VALUES ($1, $2)`, [
      klient.id,
      tag!.id,
    ]);
    await dotaz(
      `INSERT INTO "tasks" ("id", "clientId", "userId", "title", "dueAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now())`,
      [klient.id, kolega!.id, ukol],
    );

    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    const odpoved = await stranka.request.get("/ucet/moje-udaje.json");
    expect(odpoved.status()).toBe(200);
    expect(odpoved.headers()["content-type"]).toContain("application/json");
    expect(odpoved.headers()["content-disposition"]).toMatch(/moje-udaje-.*\.json/);

    const text = await odpoved.text();
    const udaje = JSON.parse(text) as Record<string, unknown>;
    expect(udaje["Osobní údaje"]).toMatchObject({ Jméno: klient.name, "E-mail": klient.email });
    expect(text).toContain(produkt);
    expect(text).toContain(zprava);

    for (const interni of [poznamka, stitek, ukol, cizi.name, cizi.email, "passwordHash"]) {
      expect(text).not.toContain(interni);
    }

    const audit = await dotaz<{ after: { format: string } }>(
      `SELECT "after" FROM "audit_log" WHERE "entityId" = $1 AND "action" = 'klient.ucet-export'`,
      [klient.id],
    );
    expect(audit).toEqual([{ after: { format: "json" } }]);

    await stranka.context().close();
  });

  test("šesté stažení za hodinu odmítne", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Limit ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);

    for (let i = 0; i < 5; i += 1) {
      expect((await stranka.request.get("/ucet/moje-udaje.json")).status()).toBe(200);
    }
    expect((await stranka.request.get("/ucet/moje-udaje.pdf")).status()).toBe(429);

    await stranka.context().close();
  });
});

test.describe("tým", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("ani administrátor údaje klienta nestáhne", async ({ page }) => {
    for (const adresa of ["/ucet/moje-udaje.json", "/ucet/moje-udaje.pdf"]) {
      const odpoved = await page.request.get(adresa, { maxRedirects: 0 });
      expect([307, 401]).toContain(odpoved.status());
    }
  });
});

test.describe("nepřihlášený", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("skončí na přihlášení klientů", async ({ page }) => {
    for (const adresa of ["/ucet/moje-udaje.json", "/ucet/moje-udaje.pdf"]) {
      const odpoved = await page.request.get(adresa, { maxRedirects: 0 });
      expect([307, 401]).toContain(odpoved.status());
    }
  });
});
