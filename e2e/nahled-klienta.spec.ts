import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  dotaz,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Rychlý náhled klienta ze seznamu (Fáze 5B, Jakub 18. 10. 2026).
 *
 * - Vidí každý přihlášený, jen čtení; nepřihlášený nic.
 * - Smazaný klient se nenačte ani přímým voláním akce.
 * - Šipky přejdou na dalšího klienta v pořadí seznamu.
 * - Na telefonu nic nepřečnívá.
 */

/** Dva klienti se společnou příponou, první s objednávkou a poznámkou. */
async function pripravKlienty(page: Page) {
  const spolecna = pripona();
  const prvni = `Nahled A ${spolecna}`;
  const druhy = `Nahled B ${spolecna}`;
  const id = (await zalozKlientaFormularem(page, prvni)).split("/").pop()!;
  const idDruheho = (await zalozKlientaFormularem(page, druhy)).split("/").pop()!;
  const poznamka = `Poznamka v nahledu ${pripona()}`;
  await dotaz(
    `INSERT INTO "client_notes" ("id", "clientId", "text", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, now(), now())`,
    [id, poznamka],
  );
  const [objednavka] = await dotaz<{ number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, 'NOVA', 'CZK', now(), now())
     RETURNING "number"`,
    [id],
  );
  return { spolecna, prvni, druhy, id, idDruheho, poznamka, cislo: objednavka!.number };
}

async function otevriNahled(page: Page, spolecna: string, jmeno: string) {
  await page.goto(`/klienti?hledat=${encodeURIComponent(spolecna)}`);
  await page.getByRole("button", { name: `Náhled: ${jmeno}` }).click();
  const panel = page.getByRole("dialog", { name: jmeno });
  await expect(panel.getByRole("heading", { name: "Poslední dění" })).toBeVisible();
  return panel;
}

test.describe("náhled klienta — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "ukáže údaje, objednávku a poslední dění; šipka přejde na dalšího",
    { tag: "@telefon" },
    async ({ page }) => {
      const k = await pripravKlienty(page);
      const panel = await otevriNahled(page, k.spolecna, k.prvni);

      await expect(
        panel.getByText(`${k.prvni.toLowerCase().replaceAll(" ", ".")}@example.test`),
      ).toBeVisible();
      await expect(panel.getByText(k.cislo, { exact: true })).toBeVisible();
      await expect(
        panel.getByRole("list", { name: "Poslední dění" }).getByText(k.poznamka),
      ).toBeVisible();
      await expect(panel.getByText(/z 2 v seznamu/)).toBeVisible();
      // Jen čtení: žádné pole ani tlačítko na změnu.
      await expect(panel.getByRole("textbox")).toHaveCount(0);
      await bezVodorovnehoPosuvu(page);

      // Druhý klient je v seznamu před, nebo za prvním — podle řazení.
      const sipka = panel.getByRole("button", {
        name: new RegExp(`^(Předchozí|Další) klient: ${k.druhy}$`),
      });
      await sipka.click();
      const druhyPanel = page.getByRole("dialog", { name: k.druhy });
      await expect(druhyPanel.getByRole("heading", { name: k.druhy })).toBeVisible();
      await expect(druhyPanel.getByText("Zatím žádná.")).toBeVisible();

      await druhyPanel.getByRole("link", { name: "Otevřít kartu" }).click();
      await expect(page).toHaveURL(new RegExp(`/klienti/${k.idDruheho}$`));
    },
  );

  test("smazaného klienta ani nepřihlášenému akce nic nevydá", async ({ page }) => {
    const k = await pripravKlienty(page);
    await page.goto(`/klienti?hledat=${encodeURIComponent(k.spolecna)}`);

    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      page.getByRole("button", { name: `Náhled: ${k.prvni}` }).click(),
    ]);
    const telo = akce.postData() ?? "";
    expect(telo).toContain(k.id);
    const zavolej = () =>
      page.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        data: telo,
        maxRedirects: 0,
      });

    await dotaz(`UPDATE "clients" SET "deletedAt" = now() WHERE "id" = $1`, [k.id]);
    const smazany = await (await zavolej()).text();
    expect(smazany).not.toContain(k.poznamka);
    expect(smazany).not.toContain(k.cislo);

    await dotaz(`UPDATE "clients" SET "deletedAt" = NULL WHERE "id" = $1`, [k.id]);
    await page.context().clearCookies();
    const bezPrihlaseni = await (await zavolej()).text();
    expect(bezPrihlaseni).not.toContain(k.poznamka);
    expect(bezPrihlaseni).not.toContain(k.cislo);
  });
});

test.describe("náhled klienta — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("otevře se i administrátorovi", async ({ page }) => {
    const k = await pripravKlienty(page);
    const panel = await otevriNahled(page, k.spolecna, k.prvni);
    await expect(panel.getByText(k.cislo, { exact: true })).toBeVisible();
  });
});
