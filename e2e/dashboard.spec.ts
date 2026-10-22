import { expect, test } from "@playwright/test";

import { menu, stavPrihlaseni } from "./pomocne";

/**
 * Dashboard po sloučení s Dneškem (22. 9. 2026).
 *
 * Obrazovka Dnešek se zrušila a její obsah — úkoly a upozornění na svátek —
 * se přesunul nahoru na Dashboard. Zkouší se pod obchodníkem, tedy
 * nejslabší rolí: Dashboard vidí každý přihlášený.
 */
test.describe("Dashboard po sloučení s Dneškem", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("stará adresa /dnesek přesměruje na Dashboard", async ({ page }) => {
    await page.goto("/dnesek");

    // `/dnesek` byl cíl po přihlášení, takže ho lidé můžou mít v záložkách.
    await expect(page).toHaveURL(/\/dashboard$/);

    // Úroveň nadpisu je nutná: „Dashboard" je i v horní liště (h1).
    await expect(page.getByRole("heading", { name: "Dashboard", level: 2 })).toBeVisible();
  });

  test("úkoly jsou nahoře, nad volbou období", async ({ page }) => {
    await page.goto("/dashboard");

    const ukoly = page.getByText("Moje úkoly", { exact: true });
    await expect(ukoly).toBeVisible();

    /*
     * Pořadí je smysl celé změny: Dashboard je dlouhý a kdyby úkoly
     * spadly pod grafy, tým by je neviděl. Porovnává se svislá poloha
     * proti přepínači období.
     */
    const ukolyBox = await ukoly.boundingBox();
    const obdobiBox = await page.getByRole("link", { name: "30 dní", exact: true }).boundingBox();

    expect(ukolyBox, "karta úkolů musí být na stránce").not.toBeNull();
    expect(obdobiBox, "přepínač období musí být na stránce").not.toBeNull();
    expect(ukolyBox!.y).toBeLessThan(obdobiBox!.y);
  });

  test("po přihlášení se chodí na Dashboard a Dnešek zmizel z menu", async ({ page }) => {
    await page.goto("/dashboard");
    const panel = await menu(page);

    await expect(panel.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Dnešek", exact: true })).toHaveCount(0);
  });
});

/**
 * Osekání Dashboardu (Jakub, 22. 9. 2026).
 *
 * Pět bloků zrušil, protože duplikovaly, co je jinde: „Hovory v čase"
 * (dlaždice + graf podle výsledku + celá sekce Hovory), „Brokeři na
 * případech" (broker se u případu nevede), „Obchodníci" (obchodníkovi
 * ukazovali jeho vlastní čísla z dlaždic), dlaždici „Brokeři" (stejně
 * nepřímé číslo jako zrušený graf) a „Klienti podle stavu" (druhá
 * pipeline hned pod první; stav klienta je na jeho kartě).
 *
 * Test hlídá, že se nevrátí nepozorovaně — třeba při slučování větví.
 */
test.describe("Dashboard po osekání", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  const ZRUSENE = [
    "Hovory v čase",
    "Brokeři na případech",
    "Obchodníci",
    "Klienti podle stavu",
    // Hovory z CRM zmizely úplně 20. 10. 2026 (Jakub).
    "Hovory podle výsledku",
    "Hovory",
    // Zrušená dlaždice. Sekce Brokeři v menu zůstává, proto se hledá
    // jen v obsahu stránky — viz `obsah` níž.
    "Brokeři",
  ];
  const ZUSTAVA = [
    "Moje úkoly",
    // Jeden cíl za firmu od 22. 9. 2026 — karta se jmenuje v jednotném čísle.
    "Plnění cíle",
    "Objednávky podle stavu",
  ];

  test("zrušené bloky na obrazovce nejsou", async ({ page }) => {
    await page.goto("/dashboard");

    // Hlavní oblast bez postranního menu — to má vlastní položku Brokeři.
    const obsah = page.getByRole("main");

    for (const blok of ZUSTAVA) {
      await expect(obsah.getByText(blok, { exact: false }).first()).toBeVisible();
    }

    for (const blok of ZRUSENE) {
      await expect(obsah.getByText(blok, { exact: true })).toHaveCount(0);
    }
  });

  /*
   * Úklid po první kontrole v prohlížeči (26. 9. 2026): procento „z
   * předchozího" u stavů objednávek vycházelo až 200 % (zaplatit jde i bez
   * kroku Nezaplaceno), popisek pruhu psal „1 objednávek" a poznámka pod
   * čarou zmiňovala portfolia, která z projektu vypadla.
   */
  test("stavy objednávek bez procent, popisky ve správném tvaru, bez portfolií", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const obsah = page.getByRole("main");

    await expect(obsah.getByText("Objednávky podle stavu")).toBeVisible();
    await expect(obsah.getByText(/z předchozího/)).toHaveCount(0);
    await expect(obsah.getByText(/portfoli/i)).toHaveCount(0);

    // Pruhy jsou obrázky s popiskem „Stav: N objednávka/objednávky/objednávek".
    const pruhy = obsah.getByRole("img", { name: /: \d+ objednáv/ });
    await expect(pruhy.first()).toBeVisible();

    for (const popisek of await pruhy.evaluateAll((prvky) =>
      prvky.map((prvek) => prvek.getAttribute("aria-label") ?? ""),
    )) {
      const [, cislo, slovo] = popisek.match(/: (\d+) (\S+)$/) ?? [];
      const n = Number(cislo);
      const cekane = n === 1 ? "objednávka" : n >= 2 && n <= 4 ? "objednávky" : "objednávek";
      expect(slovo, `popisek „${popisek}"`).toBe(cekane);
    }
  });

  test("zůstaly dvě dlaždice (Hovory zmizely 20. 10. 2026)", async ({ page }) => {
    await page.goto("/dashboard");

    // Zase jen obsah stránky: „Objednávky" jsou i v menu.
    const obsah = page.getByRole("main");

    for (const dlazdice of ["Objednávky", "Cena objednávek"]) {
      await expect(obsah.getByText(dlazdice, { exact: true }).first()).toBeVisible();
    }
  });
});

/**
 * Export statistik do CSV (Jakub, 23. 9. 2026).
 *
 * Smí ho každý přihlášený, proto se zkouší pod uživatelem — nejslabší
 * rolí. V souboru jsou jen součty z Dashboardu za zvolené období, žádná
 * jména klientů. Nepřihlášený je v `neprihlaseny.spec.ts`.
 *
 * Soubor se stahuje přes `page.request`, ne přes okno stažení: to se
 * v Safari na iPhonu chová jinak a test by hlídal prohlížeč, ne CRM.
 * Přihlášení sdílí se stránkou.
 */
test.describe("Export statistik z Dashboardu", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("tlačítko nese zvolené období a soubor má všechny tabulky", async ({ page }) => {
    // Pevný rozsah v minulosti, ať test nezávisí na dnešním datu.
    await page.goto("/dashboard?obdobi=vlastni&od=2026-01-01&do=2026-01-31");

    const tlacitko = page.getByRole("link", { name: "Stáhnout do tabulky" });
    await expect(tlacitko).toBeVisible();

    const adresa = await tlacitko.getAttribute("href");
    expect(adresa).toBe("/dashboard/export?obdobi=vlastni&od=2026-01-01&do=2026-01-31");

    const odpoved = await page.request.get(adresa!);
    expect(odpoved.status()).toBe(200);
    expect(odpoved.headers()["content-type"]).toContain("text/csv");
    expect(odpoved.headers()["content-disposition"]).toContain(
      'filename="statistiky-2026-01-01-az-2026-01-31.csv"',
    );
    expect(odpoved.headers()["cache-control"]).toContain("no-store");

    const text = await odpoved.text();
    expect(text).toContain('"Období";"1. 1. 2026 až 31. 1. 2026"');
    for (const tabulka of [
      "Souhrn",
      "Plnění cíle",
      "Objednávky podle stavu",
      "Noví klienti podle zdroje",
      "Vývoj v čase",
    ]) {
      expect(text, `v souboru chybí tabulka ${tabulka}`).toContain(`"${tabulka}`);
    }
    expect(text, "hovory z exportu zmizely").not.toContain("Hovory");

    // Jen součty — žádný e-mail ani telefon klienta se do souboru nedostane.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\+420/);
  });

  test("nepoužitelný rozsah soubor přizná", async ({ page }) => {
    // Obrácený rozsah: obrazovka i soubor spadnou na 30 dní a musí to říct.
    const odpoved = await page.request.get(
      "/dashboard/export?obdobi=vlastni&od=2026-02-01&do=2026-01-01",
    );
    expect(odpoved.status()).toBe(200);
    expect(await odpoved.text()).toContain('"Pozor"');
  });
});
