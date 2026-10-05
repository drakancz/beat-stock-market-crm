import { expect, test, type Page } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, pripona, prihlas, zalozUzivatele } from "./pomocne";

/**
 * Připomínky úkolů — zvoneček v horní liště (Jakub, 26. 9. 2026).
 *
 * **Oprávnění:** každý vidí jen svoje úkoly, nepřihlášený nic. Připomínají
 * se nehotové úkoly s termínem dnes a po termínu (pražský den).
 *
 * Každý test má vlastní účet, ať čísla nekazí úkoly z ostatních testů.
 * Úkoly se zakládají rovnou v databázi — založení formulářem hlídá
 * `ukoly.spec.ts`.
 */

/** Začátek pražského dne posunutý o `dnu` — tak ukládá termín formulář. */
const TERMIN = (dnu: number) =>
  `(date_trunc('day', now() AT TIME ZONE 'Europe/Prague') + interval '${dnu} day') AT TIME ZONE 'Europe/Prague'`;

async function zalozUkol(userId: string, title: string, dnu: number, hotovy = false) {
  const [klient] = await dotaz<{ id: string }>(
    `SELECT "id" FROM "clients" WHERE "name" = 'Jan Novák' AND "deletedAt" IS NULL`,
  );
  await dotaz(
    `INSERT INTO "tasks" ("id", "clientId", "userId", "title", "dueAt", "doneAt", "updatedAt")
     VALUES ($1, $2, $3, $4, ${TERMIN(dnu)}, ${hotovy ? "now()" : "NULL"}, now())`,
    [`e2eukol${pripona()}${pripona()}`, klient!.id, userId, title],
  );
}

function zvonecek(page: Page) {
  return page.getByRole("button", { name: /^Připomínky úkolů/ });
}

test.describe("připomínky úkolů", () => {
  test("zvoneček ukáže vlastní úkoly na dnes a po termínu, nic jiného", async ({ page }) => {
    const ja = await zalozUzivatele("uzivatel", "Zvonek");
    const kolega = await zalozUzivatele("uzivatel", "Kolega");
    const p = pripona();

    await zalozUkol(ja.id, `Dnes ${p}`, 0);
    await zalozUkol(ja.id, `Prosle ${p}`, -3);
    await zalozUkol(ja.id, `Zitra ${p}`, 1);
    await zalozUkol(ja.id, `Hotove ${p}`, 0, true);
    await zalozUkol(kolega.id, `Cizi ${p}`, 0);

    await prihlas(page, ja.email, ja.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);

    // Dva úkoly, jeden po termínu → číslo 2, v popisku i „po termínu".
    await expect(zvonecek(page)).toHaveAccessibleName("Připomínky úkolů: 2 úkoly, 1 po termínu");

    await zvonecek(page).click();
    const seznam = page.getByRole("list", { name: "Úkoly na dnes a po termínu" });
    await expect(seznam.getByRole("listitem")).toHaveCount(2);
    await expect(seznam.getByRole("listitem").filter({ hasText: `Dnes ${p}` })).toContainText(
      "dnes",
    );
    await expect(seznam.getByRole("listitem").filter({ hasText: `Prosle ${p}` })).toContainText(
      "po termínu od",
    );
    for (const nema of [`Zitra ${p}`, `Hotove ${p}`, `Cizi ${p}`]) {
      await expect(seznam.getByText(nema)).toHaveCount(0);
    }

    // Dnešní úkol v Mém dni není „Po termínu" (pražský den, 26. 9. 2026).
    await zvonecek(page).click();
    const mojeUkoly = page.locator("[data-slot='card']").filter({ hasText: "Moje úkoly" });
    const radekDnes = mojeUkoly.locator("li").filter({ hasText: `Dnes ${p}` });
    await expect(radekDnes).toBeVisible();
    await expect(radekDnes.getByText("Po termínu")).toHaveCount(0);
    await expect(
      mojeUkoly
        .locator("li")
        .filter({ hasText: `Prosle ${p}` })
        .getByText("Po termínu"),
    ).toBeVisible();

    // Odkaz na klienta vede na jeho kartu.
    await zvonecek(page).click();
    await seznam.getByRole("link", { name: "Jan Novák" }).first().click();
    await expect(page).toHaveURL(/\/klienti\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Jan Novák" })).toBeVisible();
  });

  test("odškrtnutý úkol ze zvonečku zmizí", async ({ page }) => {
    const ja = await zalozUzivatele("uzivatel", "Odskrtnuti");
    const p = pripona();
    await zalozUkol(ja.id, `Hotovo ${p}`, 0);

    await prihlas(page, ja.email, ja.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(zvonecek(page)).toHaveAccessibleName("Připomínky úkolů: 1 úkol");

    // Odškrtnutí v Mém dni obnoví i číslo ve zvonečku.
    await page
      .locator("li")
      .filter({ hasText: `Hotovo ${p}` })
      .getByRole("checkbox")
      .click();
    await expect(zvonecek(page)).toHaveAccessibleName("Připomínky úkolů: nic nezbývá");

    await zvonecek(page).click();
    await expect(page.getByText("Na dnes nic nezbývá.")).toBeVisible();
  });

  test("zvoneček je na každé obrazovce a na telefonu nic nepřečnívá", async ({ page }) => {
    const ja = await zalozUzivatele("uzivatel", "Vsude");
    await zalozUkol(ja.id, `Vsude ${pripona()}`, -1);
    await prihlas(page, ja.email, ja.heslo);
    await expect(page).toHaveURL(/\/dashboard$/);

    for (const adresa of ["/klienti", "/objednavky", "/profil"]) {
      await page.goto(adresa);
      await expect(zvonecek(page)).toHaveAccessibleName("Připomínky úkolů: 1 úkol, 1 po termínu");
      await bezVodorovnehoPosuvu(page);
    }

    // Seznam se vejde i na úzký displej.
    await zvonecek(page).click();
    const okno = page.getByRole("dialog").filter({ hasText: "Připomínky úkolů" });
    await expect(okno).toBeVisible();
    const ramec = await okno.boundingBox();
    const sirka = page.viewportSize()!.width;
    expect(ramec!.x).toBeGreaterThanOrEqual(0);
    expect(ramec!.x + ramec!.width).toBeLessThanOrEqual(sirka);
  });
});
