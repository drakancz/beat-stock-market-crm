import { defineConfig, devices } from "@playwright/test";

/**
 * Testy ukázkového režimu (Jakub, 22. 10. 2026) — samostatná sada.
 *
 *   docker compose --profile test run --rm e2e npx playwright test -c playwright.ukazka.config.ts
 *
 * Ukázkový režim (`UKAZKA=1`) vypíná e-maily, přílohy, webhooky a další
 * věci, na kterých stojí hlavní sada — proto běží na **vlastním serveru
 * (port 3200) nad vlastní databází `crm_test_ukazka`**, kterou noční
 * obnova při přípravě celou přemaže. Hlavní sada (`playwright.config.ts`)
 * o ní neví a složku `e2e-ukazka/` nepouští.
 *
 * Pouští se po hlavní sadě, ne vedle ní — dva servery naráz si konkurují
 * o výkon a sdílejí mezipaměť `.next`.
 */

const DATABAZE = "crm_test_ukazka";

const puvodni = process.env.DATABASE_URL;
if (!puvodni) {
  throw new Error("Chybí DATABASE_URL — testy se spouští přes docker compose (profil test).");
}
const adresa = new URL(puvodni);
adresa.pathname = `/${DATABAZE}`;
process.env.DATABASE_URL = adresa.toString();

const PORT = 3200;

export default defineConfig({
  testDir: "./e2e-ukazka",
  outputDir: "./e2e/vysledky-ukazka",

  timeout: 120_000,
  expect: { timeout: 20_000 },

  // Testy sdílejí jeden ukázkový účet — souběh by si šlapal po datech.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 1,

  reporter: [["list"], ["html", { outputFolder: "e2e/zprava-ukazka", open: "never" }]],

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
    // Noční obnova naplní databázi ukázkou — bez ní nejsou ukázkové účty.
    { name: "obnova", testMatch: /obnova\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["obnova"],
    },
    {
      name: "android",
      use: { ...devices["Pixel 7"] },
      grep: /@telefon/,
      dependencies: ["obnova"],
    },
  ],

  webServer: {
    command: "sh e2e-ukazka/server.sh",
    url: `http://localhost:${PORT}/prihlaseni`,
    reuseExistingServer: false,
    timeout: 600_000,
    env: { UKAZKA: "1", AUTH_URL: `http://localhost:${PORT}` },
    stdout: "ignore",
    stderr: "pipe",
  },
});
