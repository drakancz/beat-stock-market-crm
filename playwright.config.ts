import { defineConfig, devices } from "@playwright/test";

/**
 * Automatické testy v prohlížeči (Playwright).
 *
 * Spouští se jen v Dockeru:
 *   docker compose --profile test run --rm e2e
 *
 * Testy běží proti vlastní aplikaci na portu 3100 nad **oddělenou databází
 * `crm_test`**, kterou server před startem vymaže a naplní ukázkovými daty
 * (`e2e/server.sh`). Proto tu adresu databáze přepisujeme — a když by
 * výsledkem nebyla `crm_test`, testy se vůbec nespustí. Vymazat vývojová
 * data omylem nesmí jít.
 *
 * Jakub to zavedl 17. 9. 2026: každá nová funkce dostane své testy
 * a po dokončení se pustí celá sada (CLAUDE.md, oddíl Testy).
 */

const TESTOVACI_DATABAZE = "crm_test";

function adresaTestovaciDatabaze(): string {
  const puvodni = process.env.DATABASE_URL;
  if (!puvodni) {
    throw new Error("Chybí DATABASE_URL — testy se spouští přes docker compose (profil test).");
  }

  const adresa = new URL(puvodni);
  adresa.pathname = `/${TESTOVACI_DATABAZE}`;

  if (adresa.pathname.slice(1) !== TESTOVACI_DATABAZE) {
    throw new Error("Testy smí běžet jen nad databází crm_test.");
  }

  return adresa.toString();
}

// Config se načítá v hlavním procesu i v každém pracovním procesu testů,
// takže přepsání platí všude — i pro server a pomocné dotazy do databáze.
process.env.DATABASE_URL = adresaTestovaciDatabaze();

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/vysledky",

  // Vývojový server stránky překládá až při prvním otevření, na Windows
  // přes připojený disk to trvá. Lhůty jsou proto velkorysé.
  timeout: 120_000,
  expect: { timeout: 20_000 },

  fullyParallel: true,
  workers: 3,
  forbidOnly: true,
  // Jeden opakovaný pokus kvůli prvnímu překladu stránek. Test, který
  // projde až napodruhé, se ve výsledku ukáže jako „flaky" — neignorovat.
  retries: 1,

  reporter: [["list"], ["html", { outputFolder: "e2e/zprava", open: "never" }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    // Založí zkušební účty pro všechny role a přihlásí je.
    { name: "priprava", testMatch: /priprava\.setup\.ts/ },

    // Desktop, Android a iPhone (Jakub, 17. 9. 2026).
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["priprava"],
    },
    { name: "android", use: { ...devices["Pixel 7"] }, dependencies: ["priprava"] },
    { name: "iphone", use: { ...devices["iPhone 15"] }, dependencies: ["priprava"] },
  ],

  webServer: {
    command: "sh e2e/server.sh",
    url: `http://localhost:${PORT}/prihlaseni`,
    reuseExistingServer: false,
    // Vymazání databáze, migrace, ukázková data a první překlad.
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
