import { expect, test, type Page } from "@playwright/test";

import {
  cekejNaUspech,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  zalozKlientaFormularem as zalozKlienta,
} from "./pomocne";

/**
 * Klienti: založení, úprava, smazání.
 *
 * Objednávky tu nejsou — od 22. 9. 2026 je v CRM nikdo nezakládá, chodí
 * z Landing Page. Mají vlastní soubory `objednavky.spec.ts`
 * a `objednavky-prijem.spec.ts`.
 *
 * Zakládá a upravuje obchodník (to je jeho běžná práce), maže
 * administrátor — obchodník tlačítko Smazat u klienta nemá.
 */

/*
 * Jeden tvar telefonu všude: `+420 601 234 567` (Jakub, 26. 9. 2026).
 * Do té doby se číslo z formuláře uložilo, jak ho kdo napsal, a v
 * seznamu pak stálo „600 111 222" vedle „+420 602 118 447".
 */
test.describe("telefon klienta", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("uloží se jako +420 … a najde se i bez mezer", async ({ page }) => {
    const jmeno = `Test Telefon ${pripona()}`;
    const cislice = `7${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const zobrazeny = `+420 ${cislice.slice(0, 3)} ${cislice.slice(3, 6)} ${cislice.slice(6)}`;

    await zalozKlienta(page, jmeno);

    // Popisek zdroje sedí u mužů i u žen (26. 9. 2026).
    await page.getByRole("button", { name: "Upravit", exact: true }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit klienta" });
    await expect(uprava.getByText("Odkud o nás ví", { exact: true })).toBeVisible();
    await expect(uprava.getByText(/dozvěděl/)).toHaveCount(0);

    // Bez předvolby, s pomlčkami — uloží se sjednocené.
    await uprava
      .getByLabel(/Mobilní telefon/)
      .fill(`${cislice.slice(0, 3)}-${cislice.slice(3, 6)}-${cislice.slice(6)}`);
    await uprava.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `Změny jsou uložené: ${jmeno}.`);
    await expect(page.getByText(zobrazeny).first()).toBeVisible();

    // Hledání číslem bez mezer klienta najde.
    await otevriAzUvidis(
      page,
      `/klienti?hledat=${cislice}`,
      page.getByRole("link", { name: jmeno }),
    );
  });
});

test.describe("klient", () => {
  test("obchodník založí a upraví klienta, administrátor ho smaže", async ({ browser }) => {
    const jmeno = `Test Klient ${pripona()}`;
    const noveJmeno = `${jmeno} Upraveny`;

    // --- obchodník: založení a úprava ---
    const obchodnik = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await obchodnik.newPage();

    const karta = await zalozKlienta(page, jmeno);

    await page.getByRole("button", { name: "Upravit", exact: true }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit klienta" });
    await uprava.getByLabel("Jméno a příjmení").fill(noveJmeno);
    await uprava.getByLabel(/Mobilní telefon/).fill("+420 601 234 567");
    await uprava.getByRole("button", { name: "Uložit změny" }).click();

    await cekejNaUspech(page, `Změny jsou uložené: ${noveJmeno}.`);
    await expect(page.getByRole("heading", { name: noveJmeno })).toBeVisible();
    await expect(page.getByText("+420 601 234 567").first()).toBeVisible();

    // Nový klient je v jeho seznamu.
    await otevriAzUvidis(page, "/klienti", page.getByRole("link", { name: noveJmeno }));

    // Mazat klienty obchodník nesmí — tlačítko nemá.
    await page.goto(karta);
    await expect(page.getByRole("button", { name: "Smazat", exact: true })).toHaveCount(0);
    await obchodnik.close();

    // --- administrátor: smazání s potvrzením ---
    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const adminPage = await admin.newPage();
    await adminPage.goto(karta);

    await adminPage.getByRole("button", { name: "Smazat", exact: true }).click();
    const potvrzeni = adminPage.getByRole("dialog", { name: "Smazat klienta" });
    await expect(potvrzeni).toContainText(noveJmeno);
    await expect(potvrzeni).toContainText("nelze vzít zpět");

    // Zrušit nic nesmaže.
    await potvrzeni.getByRole("button", { name: "Zrušit" }).click();
    await expect(potvrzeni).toBeHidden();
    await expect(adminPage.getByRole("heading", { name: noveJmeno })).toBeVisible();

    await adminPage.getByRole("button", { name: "Smazat", exact: true }).click();
    await potvrzeni.getByRole("button", { name: "Smazat", exact: true }).click();

    await cekejNaUspech(adminPage, `Smazáno: ${noveJmeno}.`);
    await expect(adminPage).toHaveURL(/\/klienti$/);
    await expect(adminPage.getByRole("link", { name: noveJmeno })).toHaveCount(0);

    // Karta smazaného klienta už neexistuje.
    const odpoved = await adminPage.goto(karta);
    expect(odpoved?.status()).toBe(404);
    await admin.close();
  });

  test("bez e-mailu a souhlasu se klient nezaloží", async ({ browser }) => {
    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await kontext.newPage();
    const jmeno = `Test Neuplny ${pripona()}`;

    await page.goto("/klienti");
    await page.getByRole("button", { name: "Nový klient" }).click();
    const dialog = page.getByRole("dialog", { name: "Nový klient" });
    await dialog.getByLabel("Jméno a příjmení").fill(jmeno);
    await dialog.getByRole("button", { name: "Založit klienta" }).click();

    // Formulář zůstane otevřený a klient nevznikne.
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`/klienti?hledat=${encodeURIComponent(jmeno)}`);
    await expect(page.getByRole("link", { name: jmeno })).toHaveCount(0);
    await kontext.close();
  });
});

/**
 * Seznam klientů po úpravě 23. 9. 2026 (Jakub).
 *
 * Sloupce Stav, Portfolia a Poslední kontakt zanikly, místo nich Počet
 * objednávek a Poslední objednávka. Filtr podle stavu zmizel spolu se
 * sloupcem a okno „Zatím jen kostra" z celé aplikace.
 *
 * Klienta si test založí **objednávkou přes rozhraní**, stejně jako to
 * udělá Landing Page — v CRM objednávku nikdo nezakládá. Klíč je
 * testovací z `compose.yaml`. Náhodná adresa odesílatele, ať souběžné
 * testy nenarazí na omezení 30 objednávek za minutu z jedné adresy.
 */
test.describe("seznam klientů", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("ukazuje kontakt, počet a datum poslední objednávky, ne stav", async ({ page }) => {
    const znacka = pripona();
    const prijmeni = `Seznamová ${znacka}`;
    // Stejný e-mail u obou objednávek — obě patří jednomu klientovi.
    const email = `seznam.${znacka}@example.test`;
    // Náhodný telefon — duplicita se hledá i podle čísla, takže by se
    // klienti ze tří prohlížečů jinak slili do jednoho. Posílá se bez
    // mezer, jak ho ukládá příjem z webu; seznam ho ukáže po trojicích.
    const cislice = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const telefon = `+4207${cislice}`;
    const zobrazeny = `+420 7${cislice.slice(0, 2)} ${cislice.slice(2, 5)} ${cislice.slice(5)}`;

    for (let i = 0; i < 2; i++) {
      const odpoved = await page.request.post("/api/objednavky", {
        headers: {
          "X-API-Key": "e2e-objednavky-klic-nepouzivat-nikde-jinde",
          "X-Forwarded-For": nahodnaAdresa(),
        },
        data: {
          email,
          telefon,
          jmeno: "Iva",
          prijmeni,
          souhlasMarketing: false,
          nemamBrokera: true,
          produkty: [{ nazev: "Kurz Základy investování" }],
        },
      });
      expect(odpoved.status()).toBe(201);
    }

    await otevriAzUvidis(
      page,
      `/klienti?hledat=${encodeURIComponent(prijmeni)}`,
      page.getByRole("link", { name: `Iva ${prijmeni}` }),
    );

    const tabulka = page.getByRole("table");
    await expect(tabulka.getByRole("columnheader", { name: "Počet objednávek" })).toBeVisible();
    await expect(tabulka.getByRole("columnheader", { name: "Poslední objednávka" })).toBeVisible();
    for (const zrusene of ["Stav", "Portfolia", "Poslední kontakt"]) {
      await expect(tabulka.getByRole("columnheader", { name: zrusene, exact: true })).toHaveCount(
        0,
      );
    }

    // Dvě objednávky téhož klienta, poslední dnes.
    const radek = tabulka.getByRole("row", { name: new RegExp(prijmeni) });
    const bunky = radek.getByRole("cell");
    // Za nimi je od 24. 9. 2026 sloupec Platnost do (kurz nekončí → „—")
    // a od 23. 9. 2026 Přístup do programu. Od 18. 10. 2026 je před
    // Platností sloupec Body — jen na širokém displeji (xl, 1280 px).
    const sBody = (page.viewportSize()?.width ?? 0) >= 1280;
    const posun = sBody ? 1 : 0;
    await expect(bunky.nth(-4 - posun)).toHaveText("2");
    await expect(bunky.nth(-3 - posun)).toHaveText(/^\d{1,2}\. \d{1,2}\. \d{4}$/);
    if (sBody) await expect(bunky.nth(-3)).toHaveText("0");
    await expect(bunky.nth(-2)).toHaveText("—");
    await expect(bunky.nth(-1)).toHaveText("Nepovolen");

    // Pod jménem je e-mail i telefon, každý na svém řádku (23. 9. 2026).
    // Před jménem je od 11. 10. 2026 zaškrtávátko pro hromadné akce.
    const klient = bunky.nth(1);
    await expect(klient).toContainText(email);
    await expect(klient).toContainText(zobrazeny);

    // Filtr podle stavu a okno o rozpracovanosti jsou pryč.
    await expect(page.getByRole("combobox", { name: "Filtrovat podle stavu" })).toHaveCount(0);
    await expect(page.getByText("Zatím jen kostra")).toHaveCount(0);
  });

  /*
   * Řazení podle poslední objednávky, nejnovější nahoře (Jakub,
   * 23. 9. 2026); klienti bez objednávky na konci. Tři klienti se
   * společnou značkou, ať je hledání ukáže samotné. Podle jména by
   * pořadí vyšlo jinak (Bez… < Olga Novější < Olga Starší), takže test
   * řazení podle jména neprojde.
   */
  test("řadí klienty podle poslední objednávky, nejnovější nahoře", async ({ page }) => {
    const znacka = pripona();
    await zalozKlienta(page, `Bez Objednavky ${znacka}`);
    await klientSObjednavkou(page, `Starší ${znacka}`);
    await klientSObjednavkou(page, `Novější ${znacka}`);

    const tabulka = page.getByRole("table");
    await otevriAzUvidis(page, `/klienti?hledat=${znacka}`, tabulka);
    await expect(tabulka.getByRole("link")).toHaveText([
      `Olga Novější ${znacka}`,
      `Olga Starší ${znacka}`,
      `Bez Objednavky ${znacka}`,
    ]);
  });
});

/**
 * Karta klienta po přestavbě 23. 9. 2026 (Jakub).
 *
 * Nahoře jméno s e-mailem a telefonem, tlačítka Poslat email · Objednávky ·
 * Přílohy · Upravit · Smazat · Poznámky, pod tím Údaje. Záložky zmizely,
 * stav se u jména neukazuje.
 *
 * Klienta si test zakládá objednávkou přes rozhraní jako Landing Page,
 * aby měl co ukázat v okně Objednávky i zápis z webu v Poznámkách.
 */
async function klientSObjednavkou(page: Page, prijmeni: string) {
  const email = `karta.${pripona()}@example.test`;
  const odpoved = await page.request.post("/api/objednavky", {
    headers: {
      "X-API-Key": "e2e-objednavky-klic-nepouzivat-nikde-jinde",
      "X-Forwarded-For": nahodnaAdresa(),
    },
    data: {
      email,
      jmeno: "Olga",
      prijmeni,
      souhlasMarketing: false,
      nemamBrokera: true,
      produkty: [{ nazev: "Kurz Základy investování" }],
    },
  });
  expect(odpoved.status()).toBe(201);
  const { klientId, cislo } = (await odpoved.json()) as { klientId: string; cislo: string };
  return { karta: `/klienti/${klientId}`, email, jmeno: `Olga ${prijmeni}`, cislo };
}

test.describe("karta klienta", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("má nová tlačítka a Údaje, žádné záložky ani stav", async ({ page }) => {
    const { karta, email, jmeno, cislo } = await klientSObjednavkou(page, `Kartová ${pripona()}`);
    await otevriAzUvidis(page, karta, page.getByRole("heading", { name: jmeno }));

    for (const tlacitko of [
      "Poslat email",
      /Objednávky \(1\)/,
      /Přílohy \(0\)/,
      "Upravit",
      /Poznámky \(1\)/,
    ]) {
      await expect(page.getByRole("button", { name: tlacitko })).toBeVisible();
    }
    for (const zrusene of ["Napsat", "Zapsat hovor"]) {
      await expect(page.getByRole("button", { name: zrusene, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("tab")).toHaveCount(0);
    // Stav u jména zmizel — nový klient z webu by měl štítek „Nový".
    await expect(page.getByRole("main").getByText("Nový", { exact: true })).toHaveCount(0);

    const udaje = page.getByRole("main");
    await expect(udaje.getByText(email).first()).toBeVisible();
    for (const radek of ["Počet objednávek", "Poslední objednávka", "Souhlas s marketingem"]) {
      await expect(udaje.getByText(radek, { exact: true })).toBeVisible();
    }
    await expect(udaje.getByText("Neudělen", { exact: true })).toBeVisible();
    for (const zrusene of ["Souhlas s nahráváním", "Zdroj", "V systému od", "Poslední kontakt"]) {
      await expect(udaje.getByText(zrusene, { exact: true })).toHaveCount(0);
    }

    // Okno Objednávky ukáže objednávku klienta.
    await page.getByRole("button", { name: /Objednávky \(1\)/ }).click();
    const okno = page.getByRole("dialog", { name: "Objednávky" });
    await expect(okno.getByRole("list", { name: "Objednávky klienta" })).toContainText(
      "Kurz Základy investování",
    );
    // Objednávku označuje číslo (od 24. 9. 2026).
    await expect(okno.getByRole("list", { name: "Objednávky klienta" })).toContainText(cislo);
    await expect(okno.getByRole("link", { name: /Otevřít v sekci Objednávky/ })).toBeVisible();

    // Stažení objednávek klienta do tabulky (23. 9. 2026). Přes
    // `page.request`, ne okno stažení — to se v Safari chová jinak.
    const stahnout = okno.getByRole("link", { name: "Stáhnout do tabulky" });
    await expect(stahnout).toBeVisible();
    const odpoved = await page.request.get((await stahnout.getAttribute("href"))!);
    expect(odpoved.status()).toBe(200);
    expect(odpoved.headers()["content-type"]).toContain("text/csv");
    expect(odpoved.headers()["cache-control"]).toContain("no-store");
    const csv = await odpoved.text();
    expect(csv).toContain(`"Objednávky klienta";"${jmeno}"`);
    expect(csv).toContain('"Cena bez DPH";"Cena s DPH"');
    expect(csv).toContain("Kurz Základy investování");
    expect(csv).toContain(cislo);
    expect(csv).toContain('"Celkem";"Počet objednávek: 1"');
  });

  test("poznámku jde napsat, opravit a smazat; zápis z webu tam je", async ({ page }) => {
    const { karta, jmeno } = await klientSObjednavkou(page, `Poznámková ${pripona()}`);
    await otevriAzUvidis(page, karta, page.getByRole("heading", { name: jmeno }));

    await page.getByRole("button", { name: /Poznámky/ }).click();
    const okno = page.getByRole("dialog", { name: "Poznámky" });
    const seznam = okno.getByRole("list", { name: "Poznámky" });
    // Objednávka z Landing Page se zapsala jako poznámka bez autora.
    await expect(seznam).toContainText("klient přišel z objednávky na Landing Page");
    await expect(seznam).toContainText("web a objednávky");

    const text = `Chce fakturu na firmu ${pripona()}`;
    await okno.getByLabel("Nová poznámka").fill(text);
    await okno.getByRole("button", { name: "Přidat poznámku" }).click();
    await cekejNaUspech(page, "Poznámka je zapsaná.");
    const zapis = seznam.getByRole("listitem").filter({ hasText: text });
    await expect(zapis).toBeVisible();

    // U zápisu z webu (cizího) běžný uživatel opravit ani smazat nesmí.
    const zWebu = seznam.getByRole("listitem").filter({ hasText: "Landing Page" });
    await expect(zWebu.getByRole("button", { name: "Smazat poznámku" })).toHaveCount(0);

    await zapis.getByRole("button", { name: "Opravit poznámku" }).click();
    await zapis.getByLabel("Text poznámky").fill(`${text} — IČO doplní`);
    await zapis.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Poznámka je opravená.");
    await expect(seznam).toContainText("IČO doplní");

    await seznam
      .getByRole("listitem")
      .filter({ hasText: "IČO doplní" })
      .getByRole("button", { name: "Smazat poznámku" })
      .click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat poznámku" });
    await expect(potvrzeni).toContainText("nelze vzít zpět");
    await potvrzeni.getByRole("button", { name: "Smazat", exact: true }).click();
    await cekejNaUspech(page, "Poznámka je smazaná.");
    await expect(seznam).not.toContainText("IČO doplní");
  });
});

test.describe("karta klienta očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor smí opravit i smazat cizí poznámku", async ({ page }) => {
    const { karta, jmeno } = await klientSObjednavkou(page, `Správcová ${pripona()}`);
    await otevriAzUvidis(page, karta, page.getByRole("heading", { name: jmeno }));

    await page.getByRole("button", { name: /Poznámky/ }).click();
    const zWebu = page
      .getByRole("dialog", { name: "Poznámky" })
      .getByRole("listitem")
      .filter({ hasText: "Landing Page" });
    await expect(zWebu.getByRole("button", { name: "Smazat poznámku" })).toBeVisible();
    await expect(zWebu.getByRole("button", { name: "Opravit poznámku" })).toBeVisible();
  });
});
