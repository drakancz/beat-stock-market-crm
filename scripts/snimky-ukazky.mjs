// Snímky veřejné ukázky: tmavý vzhled, ukázkový režim, vymyšlená data.
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const { chromium, devices } = require("@playwright/test");

const URL = "http://localhost:3000";
const OUT = "/out";
const browser = await chromium.launch();

async function kontext(volby, jazyk = "cs") {
  const ctx = await browser.newContext({
    ...volby,
    colorScheme: "dark",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
  });
  await ctx.addCookies([{ name: "jazyk", value: jazyk, url: URL }]);
  return ctx;
}

async function sbalPruvodce(page, text = "Sbalit průvodce") {
  // Průvodce se při první návštěvě rozbalí až po načtení — počkat na něj.
  await page.waitForLoadState("networkidle");
  const tlacitko = page.getByRole("button", { name: text });
  try {
    await tlacitko.waitFor({ state: "visible", timeout: 6000 });
    await tlacitko.click();
  } catch {}
}

async function prihlas(page, cesta, tlacitko) {
  await page.goto(URL + cesta);
  await page.getByRole("button", { name: tlacitko }).click();
  await page.waitForURL((u) => !u.pathname.includes("prihlaseni"), { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

async function snimek(page, nazev) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${nazev}.png` });
  console.log("ok", nazev);
}

const desktop = { viewport: { width: 1440, height: 900 } };
const telefon = { ...devices["Pixel 7"], viewport: { width: 412, height: 839 } };

// Tým: Dashboard a karta klienta.
{
  const ctx = await kontext(desktop);
  const page = await ctx.newPage();
  await prihlas(page, "/prihlaseni", "Vyzkoušet jako člen týmu");
  await page.goto(URL + "/dashboard");
  await sbalPruvodce(page);
  await snimek(page, "dashboard");
  await page.goto(URL + "/klienti");
  await page.getByRole("link", { name: "Eva Malá" }).first().click();
  await page.waitForURL(/\/klienti\/[^/]+$/);
  await sbalPruvodce(page);
  await snimek(page, "karta-klienta");
  await ctx.close();
}

// Vstup do ukázky v angličtině (desktop).
{
  const ctx = await kontext(desktop, "en");
  const page = await ctx.newPage();
  await page.goto(URL + "/prihlaseni");
  await snimek(page, "prihlaseni-en");
  await ctx.close();
}

// Klient na telefonu: přehled, lekce a průvodce v angličtině.
{
  const ctx = await kontext(telefon);
  const page = await ctx.newPage();
  await prihlas(page, "/ucet/prihlaseni", "Vyzkoušet jako klient");
  await page.goto(URL + "/ucet");
  await sbalPruvodce(page);
  await snimek(page, "klient-telefon");
  await page.goto(URL + "/ucet/kurzy");
  await page.locator('a[href^="/ucet/kurzy/"]').first().click();
  await page.waitForURL(/\/ucet\/kurzy\/.+/);
  await page.locator('a[href^="/ucet/lekce/"]').first().click();
  await page.waitForURL(/\/ucet\/lekce\/.+/);
  await sbalPruvodce(page);
  await snimek(page, "lekce-telefon");
  await ctx.close();
}
{
  const ctx = await kontext(telefon, "en");
  const page = await ctx.newPage();
  await prihlas(page, "/ucet/prihlaseni", "Try as a client");
  await page.goto(URL + "/ucet");
  const otevrit = page.getByRole("button", { name: "What to try" });
  if (await otevrit.isVisible().catch(() => false)) await otevrit.click();
  await snimek(page, "pruvodce-telefon-en");
  await ctx.close();
}

await browser.close();
