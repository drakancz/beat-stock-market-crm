import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  jeMobil,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Objednávky (Jakub, 22. 9. 2026).
 *
 * Sekce nahradila Obchodní případy. Zásadní rozdíl, který se tu zkouší:
 *
 * - **Objednávku v CRM nikdo nezakládá** — chodí z Landing Page, takže
 *   tu není tlačítko „Nová objednávka" ani kanban.
 * - **Stav přepíná jen administrátor.** Obchodník objednávky vidí, ale
 *   výběr nedostane.
 * - **Přístup do programu je od 23. 9. 2026 u klienta** (Jakub): v sekci
 *   Objednávky není sloupec, filtr ani upozornění, přepíná se v seznamu
 *   klientů. Zkouší se tady, protože k tomu vede zaplacená objednávka.
 *
 * Objednávky se do testovací databáze zapisují přímo SQL: v rozhraní
 * k tomu cesta není a příjem z Landing Page má vlastní soubor
 * (`objednavky-prijem.spec.ts`).
 */

/** Zapíše objednávku ke klientovi tak, jak by přišla z Landing Page. */
async function zalozObjednavku(
  clientId: string,
  nazev: string,
  stav: "NOVA" | "NEZAPLACENO" | "ZAPLACENO" = "NOVA",
  /** Čas objednávky v pražském čase, `RRRR-MM-DD HH:MM`. Bez něj teď. */
  casVPraze?: string,
): Promise<string> {
  // Vrací číslo objednávky — to ji v CRM označuje (od 24. 9. 2026), název ne.
  // Prisma drží čas bez pásma v UTC, proto převod z pražského času.
  const [radek] = await dotaz<{ number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency",
                           "paidAt", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3::"OrderStatus", 'CZK',
             CASE WHEN $3 = 'ZAPLACENO' THEN now() ELSE NULL END,
             COALESCE(($4::text || ' Europe/Prague')::timestamptz AT TIME ZONE 'UTC', now()),
             now())
     RETURNING "number"`,
    [nazev, clientId, stav, casVPraze ?? null],
  );

  return radek!.number;
}

/** Id klienta z adresy jeho karty. */
function idZAdresy(adresa: string): string {
  return adresa.split("/").pop()!;
}

/** Řádek objednávky v tabulce — hledá se podle čísla objednávky. */
function radekObjednavky(page: Page, cislo: string) {
  return page.getByRole("row").filter({ hasText: cislo });
}

test.describe("objednávky očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("v CRM nejde objednávku založit", async ({ page }) => {
    await page.goto("/objednavky");

    await expect(page.getByRole("heading", { name: "Objednávky", level: 2 })).toBeVisible();

    // Tlačítko ani kanban tu po přestavbě nemají co dělat.
    await expect(page.getByRole("button", { name: /Nová objednávka|Nový případ/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Kanban" })).toHaveCount(0);
  });

  test("administrátor přepne stav, přístup pak povolí v Klientech", async ({ page }) => {
    const klient = `Objednavka Admin ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);
    const nazev = `Kurz ${pripona()}`;
    const cislo = await zalozObjednavku(idZAdresy(adresa), nazev);
    expect(cislo).toMatch(/^\d{4}-\d{4,}$/);

    // Hledá se podle čísla objednávky a řádek ho ukazuje místo názvu.
    const radek = radekObjednavky(page, cislo);
    await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(cislo)}`, radek);
    await expect(page.getByRole("main").getByText(nazev)).toHaveCount(0);

    /*
     * Přesný tvar, ne kus textu: „Zaplaceno" se jinak trefí i do
     * „Nezaplaceno" a Playwright odmítne kliknout na dvě možnosti.
     * Totéž platí o „Povolen" a „Nepovolen" níž.
     */
    await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
    await cekejNaUspech(page, /Stav objednávky je změněný/);

    // V Objednávkách už přístup není — ani sloupec, ani výběr.
    await expect(page.getByRole("columnheader", { name: "Přístup do programu" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /přístup/i })).toHaveCount(0);

    // Zaplacený klient bez přístupu = nedodělaná práce; Klienti upozorní.
    const radekKlienta = page.getByRole("row").filter({ hasText: klient });
    await otevriAzUvidis(page, `/klienti?hledat=${encodeURIComponent(klient)}`, radekKlienta);
    await expect(page.getByText(/(čeká|čekají) na přístup do programu/).first()).toBeVisible();

    // Nepovolený přístup je světle červený (Jakub, 23. 9. 2026).
    const vyberPristupu = page.getByRole("combobox", { name: `Přístup do programu: ${klient}` });
    await expect(vyberPristupu).toHaveClass(/bg-pristup-ne/);
    // Hláška nahoře je světle zelená, ne červená.
    await expect(page.getByRole("alert").filter({ hasText: /na přístup do programu/ })).toHaveClass(
      /bg-pristup-ano/,
    );

    await vyber(page, `Přístup do programu: ${klient}`, /^Povolen$/);
    await cekejNaUspech(page, /Přístup do programu je povolený/);
    await expect(vyberPristupu).toHaveText("Povolen");
    // Povolený přístup je světle zelený.
    await expect(vyberPristupu).toHaveClass(/bg-pristup-ano/);
  });

  test("objednávka jde smazat s potvrzením", async ({ page }) => {
    // Z jména se skládá e-mail, proto bez diakritiky.
    const klient = `Objednavka Kos ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);
    const nazev = `Členství ${pripona()}`;
    const cislo = await zalozObjednavku(idZAdresy(adresa), nazev);

    const smazat = page.getByRole("button", { name: `Smazat objednávku ${cislo}` });
    await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(nazev)}`, smazat);
    await smazat.click();

    const potvrzeni = page.getByRole("dialog", { name: "Smazat objednávku" });
    await expect(potvrzeni).toContainText(cislo);
    await expect(potvrzeni).toContainText("nelze vzít zpět");
    await potvrzeni.getByRole("button", { name: "Smazat", exact: true }).click();
    await expect(potvrzeni).toBeHidden();

    await expect(radekObjednavky(page, cislo)).toHaveCount(0);
  });
});

/**
 * Filtr podle času objednávky, tabulka a zrušený rámeček (Jakub, 24. 9. 2026).
 *
 * Objednávka v 0:30 pražského času je v UTC ještě předchozí den — hlídá
 * se tím, že se den počítá v Praze, ne podle pásma serveru.
 */
test.describe("čas objednávky a vzhled tabulky", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("filtr podle dne, měsíce a roku", async ({ page }) => {
    const spolecne = pripona();
    const adresa = await zalozKlientaFormularem(page, `Objednavka Cas ${spolecne}`);
    const brezen = `Brezen ${spolecne}`;
    const duben = `Duben ${spolecne}`;
    const cisloBrezen = await zalozObjednavku(
      idZAdresy(adresa),
      brezen,
      "NOVA",
      "2025-03-15 00:30",
    );
    const cisloDuben = await zalozObjednavku(idZAdresy(adresa), duben, "NOVA", "2025-04-02 23:30");
    // Rok v čísle je podle času objednávky, ne podle toho, kdy vznikl řádek.
    expect(cisloBrezen).toMatch(/^2025-/);

    const hledat = `hledat=${encodeURIComponent(spolecne)}`;
    const radekBrezen = radekObjednavky(page, cisloBrezen);
    const radekDuben = radekObjednavky(page, cisloDuben);

    await otevriAzUvidis(page, `/objednavky?${hledat}&den=2025-03-15`, radekBrezen);
    await expect(radekDuben).toHaveCount(0);

    await otevriAzUvidis(
      page,
      `/objednavky?${hledat}&den=2025-03-14`,
      page.getByText(/Žádná objednávka neodpovídá/),
    );

    await otevriAzUvidis(page, `/objednavky?${hledat}&mesic=2025-04`, radekDuben);
    await expect(radekBrezen).toHaveCount(0);

    await otevriAzUvidis(page, `/objednavky?${hledat}&rok=2025`, radekBrezen);
    await expect(radekDuben).toBeVisible();

    await otevriAzUvidis(
      page,
      `/objednavky?${hledat}&rok=2024`,
      page.getByText(/Žádná objednávka neodpovídá/),
    );

    // Totéž kliknutím: Měsíc → březen 2025.
    await otevriAzUvidis(page, `/objednavky?${hledat}`, radekDuben);
    await vyber(page, "Filtrovat podle času objednávky", "Měsíc");
    await expect(page).toHaveURL(/mesic=\d{4}-\d{2}/);
    await vyber(page, "Rok objednávky", "2025");
    await vyber(page, "Měsíc objednávky", "březen");
    await expect(page).toHaveURL(/mesic=2025-03/);
    await expect(radekBrezen).toBeVisible();
    await expect(radekDuben).toHaveCount(0);

    // Zrušit filtry zruší i čas.
    await page.getByRole("button", { name: "Zrušit filtry" }).click();
    await expect(page).not.toHaveURL(/mesic=/);
    await expect(radekDuben).toBeVisible();
  });

  test("rozbitý čas v adrese stránku neshodí", async ({ page }) => {
    const odpoved = await page.goto("/objednavky?den=zitra&mesic=2026-13&rok=abc");
    expect(odpoved?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Objednávky", level: 2 })).toBeVisible();
  });

  test("Produkty před Klientem, čas před stavem, rámeček zmizel", async ({ page }) => {
    await page.goto("/objednavky");
    await expect(page.getByRole("heading", { name: "Objednávky", level: 2 })).toBeVisible();

    // Sloupec Produkty je vidět jen na hodně širokém monitoru, v HTML je vždy.
    const sloupce = await page.locator("thead th").allTextContents();
    const produkty = sloupce.indexOf("Produkty");
    expect(produkty).toBeGreaterThan(-1);
    expect(sloupce.indexOf("Klient")).toBe(produkty + 1);

    await expect(page.getByText("Objednávka není portfolio")).toHaveCount(0);

    // Filtr času stojí před stavem (Jakub, 24. 9. 2026).
    const filtry = await page
      .getByRole("combobox")
      .evaluateAll((prvky) => prvky.map((prvek) => prvek.getAttribute("aria-label")));
    expect(filtry.indexOf("Filtrovat podle času objednávky")).toBeGreaterThan(-1);
    expect(filtry.indexOf("Filtrovat podle času objednávky")).toBeLessThan(
      filtry.indexOf("Filtrovat podle stavu"),
    );
  });
});

test.describe("objednávky očima obchodníka", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("obchodník vidí svou objednávku, ale stav nepřepíná", async ({ page }) => {
    const klient = `Objednavka Obchodnik ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);
    const nazev = `Konzultace ${pripona()}`;
    const cislo = await zalozObjednavku(idZAdresy(adresa), nazev, "ZAPLACENO");

    const radek = radekObjednavky(page, cislo);
    await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(nazev)}`, radek);

    /*
     * Stav i přístup vidí jako popisek, ne jako výběr. Hledá se první
     * výskyt: v řádku je stav dvakrát — ve svém sloupci a ve shrnutí
     * pod názvem, které se na širokém displeji skrývá, ale v HTML je.
     */
    await expect(radek.getByText(/^Zaplaceno$/).first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Změnit stav objednávky" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /přístup/i })).toHaveCount(0);

    // V Klientech vidí přístup jako popisek, přepnout ho nemůže.
    const radekKlienta = page.getByRole("row").filter({ hasText: klient });
    await otevriAzUvidis(page, `/klienti?hledat=${encodeURIComponent(klient)}`, radekKlienta);
    await expect(radekKlienta.getByText("Nepovolen", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Přístup do programu/ })).toHaveCount(0);

    // Poznámku a smazání má i obchodník.
    await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(nazev)}`, radek);
    await expect(
      radek.getByRole("button", { name: `Poznámka k objednávce ${cislo}` }),
    ).toBeVisible();
  });

  test("vidí i objednávky, které nezaložil", async ({ page }) => {
    /*
     * Do 22. 9. 2026 tu stál opačný test: objednávka klienta, který patří
     * kolegovi, se obchodníkovi neukázala. Klienti se přestali přiřazovat,
     * takže všechny objednávky vidí každý přihlášený.
     */
    await page.goto("/objednavky");

    await expect(page.getByRole("heading", { name: "Objednávky", level: 2 })).toBeVisible();
    // Objednávka ze seedu — zkušební účet ji nezakládal. V tabulce je
    // vidět její číslo (od 24. 9. 2026), ne název.
    const [zeSeedu] = await dotaz<{ number: string }>(
      `SELECT "number" FROM "orders" WHERE "name" = 'Kurz Technická analýza' AND "deletedAt" IS NULL LIMIT 1`,
    );
    expect(zeSeedu, "objednávka ze seedu").toBeDefined();
    await expect(page.getByText(zeSeedu!.number, { exact: true }).first()).toBeVisible();
  });
});

test.describe("objednávky na telefonu", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("nic nepřečnívá z okna", async ({ page }) => {
    test.skip(!jeMobil(page), "Týká se jen telefonu.");

    await page.goto("/objednavky");
    await expect(page.getByRole("heading", { name: "Objednávky", level: 2 })).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // S výběrem měsíce a roku je filtrů nejvíc.
    await page.goto("/objednavky?mesic=2026-09");
    await expect(page.getByRole("combobox", { name: "Rok objednávky" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});

test.describe("stará adresa", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("/pripady přesměruje na /objednavky", async ({ page }) => {
    await page.goto("/pripady");
    await expect(page).toHaveURL(/\/objednavky$/);
  });
});
