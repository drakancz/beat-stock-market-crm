import { expect, test, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

import { prihlas, zalozUzivatele } from "./pomocne";

/**
 * Můj profil (kontrola v prohlížeči 26. 9. 2026).
 *
 * Každý test si zakládá vlastní účet: mění se heslo a přihlášení, a to by
 * sdíleným účtům z `priprava.setup.ts` rozbilo ostatní testy.
 */

async function prihlasSe(page: Page, email: string, heslo: string) {
  await prihlas(page, email, heslo);
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Profil a počkat, až se stránka rozběhne. Formuláře se odesílají
 * obsluhou v prohlížeči a na pomalejším telefonu by klik přišel dřív
 * (26. 9. 2026 se tak na Androidu i iPhonu „neuložilo" nic).
 */
async function otevriProfil(page: Page) {
  await page.goto("/profil");
  // „Síť utichla" nestačí — `next dev` kód stránky teprve překládá.
  // Rozběhnutý formulář poznáme podle značky, kterou React připojí
  // k prvkům při hydrataci (`__reactFiber…`).
  await page.waitForFunction(() => {
    const pole = document.querySelector("#phone");
    return pole !== null && Object.keys(pole).some((klic) => klic.startsWith("__reactFiber"));
  });
}

/**
 * Šestimístný kód z klíče, jak by ho ukázala aplikace v telefonu.
 * `posun` v sekundách: kód platí jednou (26. 9. 2026), takže druhé
 * použití v témže půlminutovém okně potřebuje kód z dalšího okna —
 * server ho díky toleranci na rozjeté hodiny přijme.
 */
function kodZKlice(klic: string, posun = 0): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(klic.replace(/\s/g, "")),
  }).generate({ timestamp: Date.now() + posun * 1000 });
}

test.describe("Můj profil", () => {
  test("telefon se po uložení ukáže v jednotném tvaru", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");
    await prihlasSe(page, ucet.email, ucet.heslo);
    /*
     * Uložení s opakováním a ověření po načtení znovu. Při prvním volání
     * akce `next dev` přestaví kód a prohlížeč odpověď ztratí — Chrome
     * ji dostane bez hlášky, Safari odeslání rovnou zruší („Load request
     * cancelled"). V nasazené aplikaci se nic nepřestavuje; ověřeno
     * 26. 9. 2026 v prohlížeči i s tím, že se pole po uložení obnoví samo.
     */
    await expect(async () => {
      await otevriProfil(page);
      await page.getByLabel("Telefon").fill("601-234-567");
      // Zkušební účty se jmenují „E2E" a oslovení smí mít jen písmena —
      // navržené „E2E" by server odmítl.
      await page.getByLabel("Oslovení (5. pád)").fill("Teste");
      await page.getByRole("button", { name: "Uložit profil" }).click();
      await page.waitForTimeout(2_000);
      await otevriProfil(page);
      await expect(page.locator("#phone")).toHaveValue("+420 601 234 567", { timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
  });

  test("po změně hesla přihlášení řekne proč a pustí dovnitř novým heslem", async ({ page }) => {
    const ucet = await zalozUzivatele("uzivatel");
    await prihlasSe(page, ucet.email, ucet.heslo);
    await otevriProfil(page);

    const noveHeslo = `${ucet.heslo}-nove`;
    await page.getByLabel("Současné heslo").fill(ucet.heslo);
    await page.getByLabel("Nové heslo", { exact: true }).fill(noveHeslo);
    await page.getByLabel("Nové heslo ještě jednou").fill(noveHeslo);
    await page.getByRole("button", { name: "Změnit heslo" }).click();

    await expect(page).toHaveURL(/\/prihlaseni\?heslo=zmeneno$/);
    await expect(
      page.getByText("Heslo je změněné a všechna zařízení jsou odhlášená."),
    ).toBeVisible();

    await prihlasSe(page, ucet.email, noveHeslo);
  });

  test("dvoufázové ověření: ruční klíč, zrušení, zapnutí, přihlášení s kódem, vypnutí", async ({
    page,
  }) => {
    // Čekání na další půlminutové okno kódu (níž) test prodlužuje.
    test.setTimeout(240_000);
    const ucet = await zalozUzivatele("uzivatel");
    await prihlasSe(page, ucet.email, ucet.heslo);
    await otevriProfil(page);

    const heslo2fa = page.getByLabel("Pro potvrzení zadej svoje heslo");

    // Zrušení nastavení vrátí obrazovku, ověření se nezapne.
    await heslo2fa.fill(ucet.heslo);
    await page.getByRole("button", { name: "Zapnout" }).click();
    await expect(page.getByText("Dokonči nastavení")).toBeVisible();
    await page.getByRole("button", { name: "Zrušit" }).click();
    await expect(page.getByRole("button", { name: "Zapnout" })).toBeVisible();

    // Zapnutí přes klíč k ručnímu opsání — na telefonu QR nejde naskenovat.
    await heslo2fa.fill(ucet.heslo);
    await page.getByRole("button", { name: "Zapnout" }).click();
    const klicNaObrazovce = page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
    await expect(klicNaObrazovce).toBeVisible();
    const klic = (await klicNaObrazovce.textContent()) ?? "";

    await page.getByLabel("Kód z aplikace").fill(kodZKlice(klic));
    await page.getByRole("button", { name: "Potvrdit a zapnout" }).click();
    await expect(page.getByRole("button", { name: "Vypnout" })).toBeVisible();
    // Klíč se ukazuje jen při nastavení, pak z obrazovky zmizí.
    await expect(klicNaObrazovce).toHaveCount(0);

    // Přihlášení se teď doptá na kód. Nejdřív doběhne obnovení stránky
    // po zapnutí, jinak by se srazilo s přechodem na přihlášení.
    await page.waitForLoadState("networkidle");
    await page.context().clearCookies();
    // S opakováním: přechod na přihlášení se může srazit s obnovením
    // stránky po zapnutí (na iPhonu „navigation is interrupted").
    await expect(async () => {
      await prihlas(page, ucet.email, ucet.heslo);
      await expect(page.getByLabel("Kód z aplikace")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // Kód z potvrzení je spotřebovaný — přihlašuje se kódem z dalšího okna.
    const kodPrihlaseni = kodZKlice(klic, 30);
    await page.getByLabel("Kód z aplikace").fill(kodPrihlaseni);
    await page.getByRole("button", { name: "Ověřit a přihlásit" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Kód platí jednou: stejný kód podruhé neprojde, i když ještě platí.
    await page.waitForLoadState("networkidle");
    await page.context().clearCookies();
    await expect(async () => {
      await prihlas(page, ucet.email, ucet.heslo);
      await expect(page.getByLabel("Kód z aplikace")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Kód z aplikace").fill(kodPrihlaseni);
    await page.getByRole("button", { name: "Ověřit a přihlásit" }).click();
    await expect(
      page.getByText("Nesprávný kód. Zkontroluj, že opisuješ ten aktuální."),
    ).toBeVisible();

    // Nový kód projde. Server uzná nejvýš o jedno okno napřed, a to už je
    // spotřebované — počká se na další půlminutu (nejvýš 30 s).
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
    await page.getByLabel("Kód z aplikace").fill(kodZKlice(klic, 30));
    await page.getByRole("button", { name: "Ověřit a přihlásit" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Vypnutí.
    await otevriProfil(page);
    await heslo2fa.fill(ucet.heslo);
    await page.getByRole("button", { name: "Vypnout" }).click();
    await expect(page.getByRole("button", { name: "Zapnout" })).toBeVisible();
  });
});
