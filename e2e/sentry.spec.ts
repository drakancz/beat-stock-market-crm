import { expect, test } from "@playwright/test";

import { stavPrihlaseni } from "./pomocne";

/**
 * Hlášení chyb do Sentry (Jakub, 17. 9. 2026).
 *
 * V testech i ve vývoji musí být **vypnuté** — jinak by se do Sentry
 * sypalo každé zkušební selhání a s ním i zkušební data. Ověřuje se to
 * tak, že se sleduje, kam prohlížeč posílá požadavky.
 *
 * Že hlášení z nasazené aplikace opravdu odejde, se zkouší ručně po
 * vložení DSN — sem to nepatří, testy nesmí posílat nic ven.
 */

test.describe("Sentry", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("z testů neodchází do Sentry nic", async ({ page }) => {
    const odchozi: string[] = [];
    page.on("request", (pozadavek) => {
      const adresa = pozadavek.url();
      if (/sentry\.io|ingest\.[a-z]+\.sentry|sentry-cdn/.test(adresa)) odchozi.push(adresa);
    });

    await page.goto("/dashboard");
    await page.goto("/klienti");
    await page.goto("/smartemailing/chyby");

    // I kdyby na stránce chyba vznikla, nesmí odejít.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("zkušební chyba") }));
    });

    expect(odchozi, "z testů se do Sentry nesmí posílat nic").toEqual([]);
  });
});
