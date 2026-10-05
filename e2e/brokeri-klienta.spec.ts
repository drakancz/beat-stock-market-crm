import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Brokeři u klienta ve formuláři Upravit (Jakub, 25. 9. 2026).
 *
 * Od 23. 9. do 25. 9. 2026 šel broker vybrat jen při zakládání klienta —
 * odebrat omylem přiřazeného nešlo vůbec. Teď je v okně Upravit oddíl
 * Brokeři: přidat i odebrat (s potvrzovacím oknem) smí každý přihlášený.
 */

/** Broker v katalogu s náhodným názvem, ať se souběžné testy nepletou. */
async function zalozBrokera(): Promise<string> {
  const nazev = `Broker Klienta ${pripona()}`;
  await dotaz(`INSERT INTO "brokers" ("id", "name", "autoConnect") VALUES ($1, $2, 'ANO')`, [
    nazev.toLowerCase().replaceAll(" ", "-"),
    nazev,
  ]);
  return nazev;
}

test.describe("brokeři u klienta", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("uživatel brokera přidá a po potvrzení odebere", async ({ page }) => {
    const broker = await zalozBrokera();
    const klient = `Broker Klient ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);

    await otevriAzUvidis(page, adresa, page.getByRole("button", { name: "Upravit", exact: true }));
    await page.getByRole("button", { name: "Upravit", exact: true }).click();
    const okno = page.getByRole("dialog", { name: "Upravit klienta" });
    const oddil = okno.getByRole("region", { name: "Brokeři" });
    await expect(oddil.getByText("Klient zatím u žádného brokera není.")).toBeVisible();

    // Přidat.
    await oddil.getByRole("combobox", { name: "Vybrat brokera" }).click();
    await page.getByPlaceholder("Hledat brokera…").fill(broker);
    await page.getByRole("option", { name: broker }).click();
    await oddil.getByRole("button", { name: "Přidat" }).click();
    await cekejNaUspech(page, `${klient} má teď portfolio u brokera ${broker}.`);
    const odebrat = oddil.getByRole("button", { name: `Odebrat brokera ${broker}` });
    await expect(odebrat).toBeVisible();

    // Na telefonu okno nepřečnívá.
    await bezVodorovnehoPosuvu(page);

    // Odebrat — nejdřív Zrušit, broker zůstane.
    await odebrat.click();
    const potvrzeni = page.getByRole("dialog", { name: "Odebrat brokera" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await expect(potvrzeni.getByText(new RegExp(`${broker} u klienta ${klient}`))).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Zrušit" }).click();
    await expect(potvrzeni).toBeHidden();
    await expect(odebrat).toBeVisible();

    await odebrat.click();
    await potvrzeni.getByRole("button", { name: "Odebrat" }).click();
    await cekejNaUspech(page, `Odebráno: ${broker} u klienta ${klient}.`);
    await expect(oddil.getByText("Klient zatím u žádného brokera není.")).toBeVisible();

    // Portfolio se nemaže, jde do Smazaných.
    const [portfolio] = await dotaz<{ smazano: boolean }>(
      `SELECT p."deletedAt" IS NOT NULL AS "smazano"
       FROM "portfolios" p JOIN "brokers" b ON b."id" = p."brokerId"
       WHERE b."name" = $1`,
      [broker],
    );
    expect(portfolio?.smazano).toBe(true);

    // Znovu přidat jde — portfolio se obnoví, nezaloží podruhé.
    await oddil.getByRole("combobox", { name: "Vybrat brokera" }).click();
    await page.getByPlaceholder("Hledat brokera…").fill(broker);
    await page.getByRole("option", { name: broker }).click();
    await oddil.getByRole("button", { name: "Přidat" }).click();
    await cekejNaUspech(page, `${klient} má teď portfolio u brokera ${broker}.`);
    await expect(oddil.getByRole("button", { name: `Odebrat brokera ${broker}` })).toBeVisible();
  });
});

/**
 * Brokeři od klienta z Landing Page (Jakub, 25. 9. 2026): na kartě je
 * řádek „Broker podle klienta" — jen informace. Portfolio nevzniká,
 * řádek Broker (portfolia) zůstává prázdný, dokud ho někdo nepřiřadí.
 */
test.describe("brokeři od klienta z webu", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  /** Objednávka z Landing Page; vrací id klienta. */
  async function objednavka(page: Page, data: Record<string, unknown>) {
    const odpoved = await page.request.post("/api/objednavky", {
      headers: {
        "X-API-Key": "e2e-objednavky-klic-nepouzivat-nikde-jinde",
        "X-Forwarded-For": nahodnaAdresa(),
      },
      data: {
        email: `odklienta.${pripona()}@example.test`,
        jmeno: "Eva",
        prijmeni: `Brokerova ${pripona()}`,
        souhlasMarketing: false,
        produkty: [{ nazev: "Kurz Základy investování" }],
        ...data,
      },
    });
    expect(odpoved.status()).toBe(201);
    return ((await odpoved.json()) as { klientId: string }).klientId;
  }

  test("karta ukáže brokery od klienta, portfolio nevznikne", async ({ page }) => {
    const prvni = `Prvni Broker ${pripona()}`;
    const druhy = `Druhy Broker ${pripona()}`;
    const klientId = await objednavka(page, { brokeri: [prvni, druhy] });

    const radek = page.getByText(`${prvni}, ${druhy} (uvedeno z webu`);
    await otevriAzUvidis(page, `/klienti/${klientId}`, radek);
    await expect(page.getByText("Broker podle klienta")).toBeVisible();

    // Portfolio nevzniklo — v okně Upravit žádný broker není.
    await page.getByRole("button", { name: "Upravit", exact: true }).click();
    const oddil = page
      .getByRole("dialog", { name: "Upravit klienta" })
      .getByRole("region", { name: "Brokeři" });
    await expect(oddil.getByText("Klient zatím u žádného brokera není.")).toBeVisible();
  });

  test("„Nemám brokera“ je na kartě vidět", async ({ page }) => {
    const klientId = await objednavka(page, { nemamBrokera: true });
    await otevriAzUvidis(
      page,
      `/klienti/${klientId}`,
      page.getByText(/nemá brokera \(uvedeno z webu/),
    );
    await bezVodorovnehoPosuvu(page);
  });
});
