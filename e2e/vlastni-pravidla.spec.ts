import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import { zalozKlientaSUctem } from "./pomocne-klient";

/**
 * Vlastní pravidla (Fáze 5D, 2. část, Jakub 19. 10. 2026).
 *
 * - Skládá, zapíná a maže **jen administrátor** (i přímé volání akce),
 *   uživatel je na stránce Pravidla jen vidí.
 * - Podmínky musí platit všechny, aspoň jedna je povinná. Běží ranním
 *   plánovačem, každému klientovi jednou.
 *
 * Pravidla jsou společná pro celou testovací databázi a plánovač je pouští
 * všechna — proto má každé pravidlo podmínku na **vlastní štítek**, který
 * má jen klient z testu, a test ho na konci smaže.
 */

/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

async function spustPlanovac(request: APIRequestContext) {
  const odpoved = await request.post("/api/planovac", {
    headers: { Authorization: `Bearer ${KLIC_PLANOVACE}`, "x-forwarded-for": nahodnaAdresa() },
  });
  expect(odpoved.status()).toBe(200);
}

async function zalozStitek(nazev: string) {
  const [stitek] = await dotaz<{ id: string }>(
    `INSERT INTO "client_tags" ("id", "name", "color", "updatedAt")
     VALUES ($1, $2, 'ZNACKA'::"TagColor", now()) RETURNING "id"`,
    [`e2estitek${pripona()}${pripona()}`, nazev],
  );
  return stitek!.id;
}

async function oznac(clientId: string, tagId: string) {
  await dotaz(`INSERT INTO "client_tag_links" ("clientId", "tagId") VALUES ($1, $2)`, [
    clientId,
    tagId,
  ]);
}

async function smazPravidlo(nazev: string) {
  await dotaz(
    `UPDATE "custom_rules" SET "deletedAt" = now(), "enabled" = false WHERE "name" = $1`,
    [nazev],
  );
}

test.describe("vlastní pravidla — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "složí pravidlo, zapne ho, plánovač udělá úkol a štítek jen jednou; uživatel přímo nezaloží",
    { tag: "@telefon" },
    async ({ page, browser, request }) => {
      const p = pripona();
      const nazev = `VIP ozvat ${p}`;
      const vip = `VIP ${p}`;
      const hotovo = `Osloven ${p}`;
      const vipId = await zalozStitek(vip);
      const hotovoId = await zalozStitek(hotovo);
      const klient = await zalozKlientaSUctem(`Pravidlový ${p}`);
      await oznac(klient.id, vipId);
      const [kolega] = await dotaz<{ id: string; name: string }>(
        `SELECT "id", "name" FROM "users" WHERE "active" AND "deletedAt" IS NULL ORDER BY "name" LIMIT 1`,
      );

      await page.goto("/pravidla");
      await page.getByRole("button", { name: "Nové pravidlo" }).click();
      const okno = page.getByRole("dialog", { name: "Nové pravidlo" });
      await okno.getByLabel("Název", { exact: true }).fill(nazev);

      // Bez podmínky neprojde.
      await okno.getByLabel("Přidat akci").selectOption("ukol");
      await okno.getByLabel("Název úkolu").fill("Zavolat VIP klientovi");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await expect(okno.getByText(/Přidej aspoň jednu podmínku/)).toBeVisible();

      await okno.getByLabel("Přidat podmínku").selectOption("stitek");
      await okno.getByLabel("Štítek", { exact: true }).selectOption({ label: vip });
      await okno.getByLabel("Komu").selectOption({ label: kolega!.name });
      await okno.getByLabel("Přidat akci").selectOption("stitek");
      await okno.getByLabel("Štítek akce").selectOption({ label: hotovo });
      await bezVodorovnehoPosuvu(page);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Uložit" }).click(),
      ]);
      await cekejNaUspech(page, `Pravidlo je založené (zatím vypnuté): ${nazev}.`);

      const radek = page.getByTestId("vlastni-pravidlo").filter({ hasText: nazev });
      await expect(radek.getByText(`má štítek ${vip}`)).toBeVisible();
      await expect(radek.getByText("Teď splňuje: 1")).toBeVisible();

      // Vypnuté pravidlo plánovač nespustí.
      await spustPlanovac(request);
      const ukoly = () =>
        dotaz(
          `SELECT 1 FROM "tasks" WHERE "clientId" = $1 AND "title" = 'Zavolat VIP klientovi' AND "deletedAt" IS NULL`,
          [klient.id],
        );
      expect(await ukoly()).toHaveLength(0);

      // Zapnutí se potvrzuje s počtem klientů.
      await radek.getByRole("button", { name: "Zapnout" }).click();
      const zapnout = page.getByRole("dialog", { name: "Zapnout pravidlo" });
      await expect(zapnout.getByText(/teď je jich 1/)).toBeVisible();
      await zapnout.getByRole("button", { name: "Zapnout" }).click();
      await cekejNaUspech(page, `Pravidlo je zapnuté: ${nazev}.`);

      await spustPlanovac(request);
      expect(await ukoly()).toHaveLength(1);
      const stitek = await dotaz(
        `SELECT 1 FROM "client_tag_links" WHERE "clientId" = $1 AND "tagId" = $2`,
        [klient.id, hotovoId],
      );
      expect(stitek).toHaveLength(1);
      // Podruhé už nic.
      await spustPlanovac(request);
      expect(await ukoly()).toHaveLength(1);

      // Uživatel zopakuje volání s jiným názvem — server ho odmítne.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const podvrh = `Podvržené ${p}`;
      await tym.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        data: (akce.postData() ?? "").replace(nazev, podvrh),
      });
      expect(await dotaz(`SELECT 1 FROM "custom_rules" WHERE "name" = $1`, [podvrh])).toHaveLength(
        0,
      );
      await tym.close();

      // Smazání s potvrzením.
      await otevriAzUvidis(page, "/pravidla", radek);
      await radek.getByRole("button", { name: `Smazat pravidlo: ${nazev}` }).click();
      const smazat = page.getByRole("dialog", { name: "Smazat pravidlo" });
      await expect(smazat.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await smazat.getByRole("button", { name: "Smazat" }).click();
      await cekejNaUspech(page, `Smazáno: ${nazev}.`);
      await expect(page.getByTestId("vlastni-pravidlo").filter({ hasText: nazev })).toHaveCount(0);
    },
  );

  test("zpráva odejde jen klientovi s účtem", async ({ request }) => {
    const p = pripona();
    const nazev = `Zpráva ${p}`;
    const tagId = await zalozStitek(`Zprávový ${p}`);
    const sUctem = await zalozKlientaSUctem(`S účtem ${p}`);
    const [bezUctu] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES ($1, $2, $3, 'landing-page', now()) RETURNING "id"`,
      [`e2ebez${p}${pripona()}`, `Bez účtu ${p}`, `bez-${p}@example.test`],
    );
    await oznac(sUctem.id, tagId);
    await oznac(bezUctu!.id, tagId);
    const text = `Dlouho jsme vás neviděli ${p}`;
    await dotaz(
      `INSERT INTO "custom_rules" ("id", "name", "enabled", "conditions", "actions", "updatedAt")
       VALUES ($1, $2, true, $3::jsonb, $4::jsonb, now())`,
      [
        `e2epravidlo${p}`,
        nazev,
        JSON.stringify([{ druh: "stitek", tagId, ma: true }]),
        JSON.stringify([{ druh: "zprava", nadpis: "Chybíte nám", text }]),
      ],
    );

    await spustPlanovac(request);
    const zpravy = await dotaz<{ clientId: string }>(
      `SELECT "clientId" FROM "client_messages" WHERE "text" = $1`,
      [text],
    );
    expect(zpravy.map((z) => z.clientId)).toEqual([sUctem.id]);
    await smazPravidlo(nazev);
  });
});

test.describe("vlastní pravidla — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("vidí pravidlo, ale nemůže ho založit, zapnout ani smazat", async ({ page }) => {
    const p = pripona();
    const nazev = `Jen ke čtení ${p}`;
    const tagId = await zalozStitek(`Čtecí ${p}`);
    await dotaz(
      `INSERT INTO "custom_rules" ("id", "name", "conditions", "actions", "updatedAt")
       VALUES ($1, $2, $3::jsonb, $4::jsonb, now())`,
      [
        `e2epravidlo${p}`,
        nazev,
        JSON.stringify([{ druh: "stitek", tagId, ma: true }]),
        JSON.stringify([{ druh: "stitek", tagId, pridat: false }]),
      ],
    );

    await page.goto("/pravidla");
    const radek = page.getByTestId("vlastni-pravidlo").filter({ hasText: nazev });
    await expect(radek.getByText(`odebrat štítek Čtecí ${p}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Nové pravidlo" })).toHaveCount(0);
    await expect(radek.getByRole("button")).toHaveCount(0);
    await smazPravidlo(nazev);
  });
});
