import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { zasifruj } from "../src/lib/tajemstvi";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Odchozí webhooky (Jakub, 19. 10. 2026).
 *
 * - Nastavuje **jen administrátor** — uživatel dostane 404 a akci
 *   nezavolá ani napřímo.
 * - Jen `https` a ne do vnitřní sítě. V testech smí jen na napodobeninu
 *   služby v kontejneru (`WEBHOOKY_ZKUSEBNI_ADRESA`, `napodobenina-webhooku.mjs`).
 * - **Ve zprávě nejsou e-maily ani telefony**, je podepsaná tajemstvím,
 *   které se ukáže jednou.
 * - Nedoručená zpráva skončí v Chybách a u webhooku.
 *
 * Webhooky jsou společné pro celou testovací databázi — každý test si
 * zakládá vlastní adresu s příponou a na konci webhook smaže.
 */

const NAPODOBENINA = "http://localhost:3198";

async function prijate(obsahuje: string) {
  const odpoved = await fetch(`${NAPODOBENINA}/prijate?obsahuje=${encodeURIComponent(obsahuje)}`);
  return (await odpoved.json()) as {
    cesta: string;
    hlavicky: { udalost: string; cas: string; podpis: string };
    telo: string;
  }[];
}

test.describe("webhooky — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "založí webhook, zpráva o novém klientovi je podepsaná a bez kontaktů; uživatel přímo nezaloží",
    { tag: "@telefon" },
    async ({ page, browser }) => {
      const p = pripona();
      const cesta = `/prijem-${p}`;
      const nazev = `Zapier ${p}`;

      await page.goto("/nastaveni/webhooky");
      await page.getByRole("button", { name: "Nový webhook" }).click();
      const okno = page.getByRole("dialog", { name: "Nový webhook" });

      // Adresa mimo https a do vnitřní sítě neprojde.
      await okno.getByLabel("Název").fill(nazev);
      await okno.getByLabel("Adresa").fill("https://localhost/hook");
      await okno.getByRole("checkbox", { name: "Nový klient" }).check();
      await okno.getByRole("button", { name: "Uložit" }).click();
      await expect(okno.getByText(/vnitřní sít/)).toBeVisible();
      await okno.getByLabel("Adresa").fill("http://example.com/hook");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await expect(okno.getByText("Adresa musí začínat https://.")).toBeVisible();

      await okno.getByLabel("Adresa").fill(`${NAPODOBENINA}${cesta}`);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Uložit" }).click(),
      ]);
      await cekejNaUspech(page, `Webhook je založený: ${nazev}.`);
      const tajemstvi = await okno.getByLabel("Tajemství webhooku").inputValue();
      expect(tajemstvi).toMatch(/^whsec_/);
      await okno.getByRole("button", { name: "Hotovo" }).click();
      // Tajemství se podruhé neukáže nikde.
      expect(await page.content()).not.toContain(tajemstvi);

      const radek = page.getByTestId("webhook").filter({ hasText: nazev });
      await radek.getByRole("button", { name: `Vyzkoušet webhook: ${nazev}` }).click();
      await cekejNaUspech(page, "Zkušební zpráva dorazila");
      await bezVodorovnehoPosuvu(page);

      // Nový klient → zpráva se jménem, bez e-mailu, s platným podpisem.
      const jmeno = `Webhook Klient ${p}`;
      await zalozKlientaFormularem(page, jmeno);
      await expect(async () => {
        const zpravy = (await prijate(jmeno)).filter((z) => z.cesta === cesta);
        expect(zpravy).toHaveLength(1);
        const [zprava] = zpravy;
        expect(zprava!.hlavicky.udalost).toBe("klient.novy");
        expect(zprava!.telo).not.toContain("@");
        expect(zprava!.telo).not.toContain("example.test");
        const ocekavany = `sha256=${createHmac("sha256", tajemstvi)
          .update(`${zprava!.hlavicky.cas}.${zprava!.telo}`)
          .digest("hex")}`;
        expect(zprava!.hlavicky.podpis).toBe(ocekavany);
      }).toPass({ timeout: 20_000 });

      // Uživatel zopakuje volání s jiným názvem — server ho odmítne.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const podvrh = `Podvržený ${p}`;
      await tym.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        data: (akce.postData() ?? "").replace(nazev, podvrh),
      });
      const zalozene = await dotaz(`SELECT 1 FROM "outgoing_webhooks" WHERE "name" = $1`, [podvrh]);
      expect(zalozene, "uživatel nesmí webhook založit").toHaveLength(0);
      await tym.close();

      // Smazání s potvrzením.
      await otevriAzUvidis(page, "/nastaveni/webhooky", radek);
      await radek.getByRole("button", { name: `Smazat webhook: ${nazev}` }).click();
      const potvrzeni = page.getByRole("dialog", { name: "Smazat webhook" });
      await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await potvrzeni.getByRole("button", { name: "Smazat" }).click();
      await cekejNaUspech(page, `Smazáno: ${nazev}.`);
      await expect(page.getByTestId("webhook").filter({ hasText: nazev })).toHaveCount(0);
    },
  );

  test("nedoručená zpráva se ukáže u webhooku a v Chybách", async ({ page }) => {
    const p = pripona();
    const nazev = `Nefunkční ${p}`;
    const [webhook] = await dotaz<{ id: string }>(
      `INSERT INTO "outgoing_webhooks" ("id", "name", "url", "secretEncrypted", "events", "updatedAt")
       VALUES ($1, $2, $3, $4, ARRAY['klient.novy'], now()) RETURNING "id"`,
      [`e2ewh${p}`, nazev, `${NAPODOBENINA}/chyba-${p}`, zasifruj("whsec_zkouska")],
    );

    await otevriAzUvidis(
      page,
      "/nastaveni/webhooky",
      page.getByTestId("webhook").filter({ hasText: nazev }),
    );
    const radek = page.getByTestId("webhook").filter({ hasText: nazev });
    // Zkušební zpráva: služba odpoví 500.
    await radek.getByRole("button", { name: `Vyzkoušet webhook: ${nazev}` }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Služba odpověděla 500." }).first(),
    ).toBeVisible();
    await expect(radek.getByText(/Služba odpověděla 500/)).toBeVisible();

    // Skutečná událost → nedoručeno → záznam v Chybách pod Webhooky.
    await zalozKlientaFormularem(page, `Nedoruceny ${p}`);
    await expect(async () => {
      await page.goto("/smartemailing/chyby?druh=webhook");
      await expect(page.getByText(`${nazev}:`).first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await otevriAzUvidis(page, "/nastaveni/webhooky", radek);

    // Vypnout a zase zapnout.
    await radek.getByRole("button", { name: "Vypnout" }).click();
    await cekejNaUspech(page, `Webhook je vypnutý: ${nazev}.`);
    await expect(radek.getByText("Vypnutý", { exact: true })).toBeVisible();

    await dotaz(`UPDATE "outgoing_webhooks" SET "deletedAt" = now() WHERE "id" = $1`, [
      webhook!.id,
    ]);
  });
});

test.describe("webhooky — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("Nastavení → Webhooky neexistuje", async ({ page }) => {
    const odpoved = await page.goto("/nastaveni/webhooky");
    expect(odpoved?.status()).toBe(404);
  });
});
