// Kolik JavaScriptu stáhne prohlížeč, než ukáže obrazovku (24. 10. 2026).
// Měří se produkční verze v ukázkovém režimu, každá obrazovka v čistém
// prohlížeči (bez mezipaměti). Postup je v docs/funkce/vzhled.md.
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const { chromium } = require("@playwright/test");

const URL = "http://localhost:3000";
const browser = await chromium.launch();

const prihlaseni = await browser.newContext();
const page = await prihlaseni.newPage();
await page.goto(`${URL}/prihlaseni`);
await page.getByRole("button", { name: "Vyzkoušet jako člen týmu" }).click();
await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
await page.goto(`${URL}/klienti`);
const karta = await page.locator('a[href^="/klienti/c"]').first().getAttribute("href");
const stav = await prihlaseni.storageState();
await prihlaseni.close();

for (const adresa of ["/profil", "/dashboard", "/klienti", karta]) {
  const vysledky = [];
  for (let pokus = 0; pokus < 3; pokus++) {
    const kontext = await browser.newContext({ storageState: stav });
    const stranka = await kontext.newPage();
    await stranka.goto(URL + adresa, { waitUntil: "load" });
    vysledky.push(
      await stranka.evaluate(() => {
        const zdroje = performance.getEntriesByType("resource");
        const js = zdroje.filter((z) => z.initiatorType === "script" || z.name.endsWith(".js"));
        const nav = performance.getEntriesByType("navigation")[0];
        return {
          js: Math.round(js.reduce((s, z) => s + z.encodedBodySize, 0) / 1024),
          souboru: js.length,
          html: Math.round(nav.encodedBodySize / 1024),
          nacteno: Math.round(nav.loadEventEnd),
        };
      }),
    );
    await kontext.close();
  }
  const median = (k) => vysledky.map((v) => v[k]).sort((a, b) => a - b)[1];
  console.log(
    `${adresa.padEnd(42)} JS ${median("js")} kB (${median("souboru")} souborů), HTML ${median("html")} kB, načteno za ${median("nacteno")} ms`,
  );
}
await browser.close();
