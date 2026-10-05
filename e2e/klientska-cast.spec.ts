import { randomBytes } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

import { zahesluj } from "../src/lib/hesla";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";

/**
 * Klientská část — přihlášení klienta (krok 3A, Jakub, 30. 9. 2026).
 *
 * Co se tu hlídá:
 *
 * - **Pozvat a zrušit přístup smí jen administrátor**; stav vidí na kartě
 *   klienta každý přihlášený.
 * - **Klient se nikdy nedostane do CRM** a člověk z týmu do klientské
 *   části — přihlášení jsou oddělená.
 * - Zrušení přístupu i smazání klienta ho okamžitě odhlásí.
 * - Hlášky při přihlášení neprozradí, jestli e-mail v systému je.
 *
 * Klienti a jejich účty se připravují přímo SQL; samotné chování se
 * zkouší v prohlížeči. E-mail s pozvánkou se čte z Mailpitu.
 */

const MAILPIT = "http://mailpit:8025";

/** Zdroj, který zakládá migrace (`ZDROJ_LANDING_PAGE` v `src/lib/leady.ts`). */
const ZDROJ = "landing-page";

/** Založí klienta (bez účtu do klientské části). */
async function zalozKlienta(jmeno: string) {
  const email = `klient-${pripona()}@example.test`;
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, $4, now())
     RETURNING "id"`,
    [`e2e${pripona()}${pripona()}`, jmeno, email, ZDROJ],
  );
  return { id: klient!.id, email, name: jmeno };
}

/** Založí klienta i s hotovým účtem a náhodným heslem. */
async function zalozKlientaSUctem(jmeno: string) {
  const klient = await zalozKlienta(jmeno);
  const heslo = randomBytes(18).toString("base64url");
  await dotaz(
    `INSERT INTO "client_accounts"
       ("id", "clientId", "passwordHash", "passwordSetAt", "invitedAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now(), now())`,
    [`e2e${pripona()}${pripona()}`, klient.id, await zahesluj(heslo)],
  );
  return { ...klient, heslo };
}

/** Přihlášení formulářem klientské části. */
async function prihlasKlienta(page: Page, email: string, heslo: string) {
  await page.goto("/ucet/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill(heslo);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
}

/** Nový prohlížeč bez jakéhokoli přihlášení — tak, jak přijde klient. */
async function prohlizecKlienta(browser: Browser): Promise<Page> {
  // Prázdné přihlášení výslovně — jinak by si kontext vzal `storageState`
  // z `test.use()` a klient by byl přihlášený jako administrátor.
  const kontext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await kontext.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  return kontext.newPage();
}

/** Odkaz z posledního e-mailu, který přišel na danou adresu. */
async function odkazZEmailu(komu: string): Promise<string> {
  let odkaz: string | undefined;
  await expect(async () => {
    const hledani = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
    );
    const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
    expect(messages.length).toBeGreaterThan(0);

    const zprava = await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
    const { Text } = (await zprava.json()) as { Text: string };
    odkaz = Text.match(/https?:\/\/\S+\/ucet\/nove-heslo\?token=\S+/)?.[0];
    expect(odkaz).toBeTruthy();
  }).toPass({ timeout: 15_000 });

  // Odkaz míří na AUTH_URL testovací aplikace — prohlížeč jde na tutéž.
  const url = new URL(odkaz!);
  return url.pathname + url.search;
}

test.describe("pozvánka a přihlášení", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor pozve klienta, klient si nastaví heslo a přihlásí se", async ({
    page,
    browser,
  }) => {
    const klient = await zalozKlienta(`Klient Pozvaný ${pripona()}`);

    await page.goto(`/klienti/${klient.id}`);
    await expect(page.getByText("Nemá účet")).toBeVisible();
    await page.getByRole("button", { name: "Pozvat do klientské části" }).click();
    await cekejNaUspech(page, "Pozvánka do klientské části odešla");
    await expect(page.getByText(/Pozvánka odeslána/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Poslat pozvánku znovu" })).toBeVisible();

    // Klient v úplně jiném prohlížeči — bez přihlášení týmu.
    const klientskaStranka = await prohlizecKlienta(browser);
    await klientskaStranka.goto(await odkazZEmailu(klient.email));
    const heslo = `${randomBytes(12).toString("base64url")}-Aa1`;
    await klientskaStranka.getByLabel("Nové heslo").fill(heslo);
    await klientskaStranka.getByLabel("Heslo ještě jednou").fill(heslo);
    await klientskaStranka.getByRole("button", { name: "Nastavit heslo" }).click();
    await klientskaStranka.getByRole("button", { name: "Pokračovat do klientské části" }).click();

    await expect(klientskaStranka).toHaveURL(/\/ucet$/);
    await expect(
      klientskaStranka.getByRole("heading", { name: `Dobrý den, ${klient.name}` }),
    ).toBeVisible();
    await bezVodorovnehoPosuvu(klientskaStranka);

    // Do CRM se klient nedostane — jeho přihlášení tam nic neznamená.
    await klientskaStranka.goto("/dashboard");
    await expect(klientskaStranka).toHaveURL(/\/prihlaseni/);
    await klientskaStranka.goto("/klienti");
    await expect(klientskaStranka).toHaveURL(/\/prihlaseni/);

    // Odhlášení.
    await klientskaStranka.goto("/ucet");
    await klientskaStranka.getByRole("button", { name: "Odhlásit" }).click();
    await expect(klientskaStranka).toHaveURL(/\/ucet\/prihlaseni/);
    await klientskaStranka.goto("/ucet");
    await expect(klientskaStranka).toHaveURL(/\/ucet\/prihlaseni/);

    // Na kartě je klient aktivní a pozvat ho znovu nejde.
    await otevriAzUvidis(page, `/klienti/${klient.id}`, page.getByText(/^Aktivní/));
    await expect(page.getByRole("button", { name: /Pozvat|Poslat pozvánku/ })).toHaveCount(0);

    await klientskaStranka.context().close();
  });

  test("zrušení přístupu klienta okamžitě odhlásí a přihlásit se už nejde", async ({
    page,
    browser,
  }) => {
    const klient = await zalozKlientaSUctem(`Klient Zrušený ${pripona()}`);

    const klientskaStranka = await prohlizecKlienta(browser);
    await prihlasKlienta(klientskaStranka, klient.email, klient.heslo);
    await expect(klientskaStranka).toHaveURL(/\/ucet$/);

    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: "Zrušit přístup" }).click();
    const okno = page.getByRole("dialog", { name: "Zrušit přístup do klientské části" });
    await expect(okno).toContainText(klient.name);
    await expect(okno).toContainText("Tuhle akci nelze vzít zpět.");
    await okno.getByRole("button", { name: "Zrušit přístup" }).click();
    await cekejNaUspech(page, `Přístup do klientské části je zrušený: ${klient.name}.`);
    await expect(page.getByText("Přístup zrušený")).toBeVisible();

    // Klient je odhlášený hned, bez čekání na vypršení.
    await klientskaStranka.goto("/ucet");
    await expect(klientskaStranka).toHaveURL(/\/ucet\/prihlaseni/);
    await prihlasKlienta(klientskaStranka, klient.email, klient.heslo);
    await expect(klientskaStranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();

    await klientskaStranka.context().close();
  });

  test("člověk z týmu se do klientské části nedostane", async ({ page }) => {
    await page.goto("/ucet");
    await expect(page).toHaveURL(/\/ucet\/prihlaseni/);
  });
});

test.describe("uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("vidí stav klientské části, ale pozvat ani zrušit nemůže", async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Klient Stav ${pripona()}`);

    await page.goto(`/klienti/${klient.id}`);
    await expect(page.getByText("Aktivní, zatím bez přihlášení")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zrušit přístup" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Pozvat/ })).toHaveCount(0);
  });
});

test.describe("přihlášení klienta", () => {
  test("smazaný klient se nepřihlásí", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Smazaný ${pripona()}`);
    await dotaz(`UPDATE "clients" SET "deletedAt" = now() WHERE "id" = $1`, [klient.id]);

    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    await stranka.context().close();
  });

  test("špatné heslo i neznámý e-mail dostanou stejnou hlášku", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Heslo ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);

    await prihlasKlienta(stranka, klient.email, `${klient.heslo}x`);
    await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();

    await prihlasKlienta(stranka, "nikdo-takovy@example.test", klient.heslo);
    await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    await stranka.context().close();
  });

  test("po pěti špatných pokusech zablokuje i správné heslo", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Limit ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);

    for (let pokus = 0; pokus < 5; pokus++) {
      await prihlasKlienta(stranka, klient.email, `spatne-${pokus}`);
      await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    }

    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka.getByText(/Příliš mnoho neúspěšných pokusů/)).toBeVisible();
    await stranka.context().close();
  });

  test("zapomenuté heslo pošle odkaz a nové heslo platí", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Zapomněl ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);

    // Při prvním překladu stránky testovací server přestaví kód a kliknutí
    // se ztratí (žádný požadavek neodejde) — proto znovu načíst a zkusit.
    await expect(async () => {
      await stranka.goto("/ucet/zapomenute-heslo");
      await stranka.getByLabel("E-mail").fill(klient.email);
      await stranka.getByRole("button", { name: "Poslat odkaz" }).click();
      await expect(stranka.getByText(/Pokud u nás taková adresa je/)).toBeVisible({
        timeout: 15_000,
      });
    }).toPass({ timeout: 60_000 });

    await stranka.goto(await odkazZEmailu(klient.email));
    const noveHeslo = `${randomBytes(12).toString("base64url")}-Bb2`;
    await stranka.getByLabel("Nové heslo").fill(noveHeslo);
    await stranka.getByLabel("Heslo ještě jednou").fill(noveHeslo);
    await stranka.getByRole("button", { name: "Nastavit heslo" }).click();
    await expect(stranka.getByText("Heslo je nastavené a jste přihlášeni.")).toBeVisible();

    // Staré heslo už neplatí, nové ano.
    await stranka.context().clearCookies();
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    await prihlasKlienta(stranka, klient.email, noveHeslo);
    await expect(stranka).toHaveURL(/\/ucet$/);
    await stranka.context().close();
  });

  test("nepřihlášený skončí na přihlášení klientů, texty se otevřou", async ({ page }) => {
    await page.goto("/ucet");
    await expect(page).toHaveURL(/\/ucet\/prihlaseni/);
    await bezVodorovnehoPosuvu(page);

    await page.getByRole("link", { name: "Ochrana osobních údajů" }).click();
    await expect(page).toHaveURL(/\/ucet\/zasady$/);
    await expect(
      page.getByRole("heading", { name: "Zásady ochrany osobních údajů" }),
    ).toBeVisible();
    await expect(page.getByText(/Úřadu pro ochranu osobních údajů/)).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    await page.goto("/ucet/podminky");
    await expect(
      page.getByRole("heading", { name: "Podmínky používání klientské části" }),
    ).toBeVisible();
    // Pravidlo 9: nic v klientské části není investiční doporučení.
    await expect(
      page.getByRole("heading", { name: /Nejde o investiční doporučení/ }),
    ).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});

/** Zapíše objednávku ke klientovi (jako z Landing Page) a vrátí její číslo. */
async function zalozObjednavku(clientId: string, zaplacena: boolean) {
  const [produkt] = await dotaz<{ id: string; name: string }>(
    `SELECT "id", "name" FROM "products" WHERE "deletedAt" IS NULL AND "kind" = 'KURZ' LIMIT 1`,
  );
  const [objednavka] = await dotaz<{ id: string; number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, $2::"OrderStatus", 'CZK',
             CASE WHEN $3 THEN now() ELSE NULL END, now(), now())
     RETURNING "id", "number"`,
    [clientId, zaplacena ? "ZAPLACENO" : "NOVA", zaplacena],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, produkt!.id],
  );
  return { number: objednavka!.number, produkt: produkt!.name };
}

/** Kód z ověřovací aplikace — stejně jako v `profil.spec.ts`. */
function kodZKlice(klic: string, posun = 0): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(klic.replace(/\s/g, "")),
  }).generate({ timestamp: Date.now() + posun * 1000 });
}

test.describe("co klient vidí (část 2)", () => {
  test("vidí jen svoje objednávky, zaplacený kurz a přístup do programu", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Přehled ${pripona()}`);
    const cizi = await zalozKlienta(`Klient Cizí ${pripona()}`);
    const zaplacena = await zalozObjednavku(klient.id, true);
    const nova = await zalozObjednavku(klient.id, false);
    const ciziObjednavka = await zalozObjednavku(cizi.id, true);

    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka).toHaveURL(/\/ucet$/);

    const objednavky = stranka.getByRole("list", { name: "Moje objednávky" });
    await expect(objednavky).toContainText(`Objednávka ${zaplacena.number}`);
    await expect(objednavky).toContainText(`Objednávka ${nova.number}`);
    await expect(objednavky).toContainText("Zaplaceno");
    await expect(objednavky).toContainText("Nová objednávka");
    // Cizí objednávka se neukáže nikde.
    await expect(stranka.getByText(`Objednávka ${ciziObjednavka.number}`)).toHaveCount(0);

    // Zaplacený kurz platí napořád; nezaplacená objednávka nic nepřidá.
    const produkty = stranka.getByRole("list", { name: "Členství a produkty" });
    await expect(produkty).toContainText(zaplacena.produkt);
    await expect(produkty).toContainText("neomezeně");

    await expect(stranka.getByText("Zatím nepovolen")).toBeVisible();
    await expect(stranka.getByText(klient.email)).toBeVisible();
    await bezVodorovnehoPosuvu(stranka);

    // Poznámky ani nic z CRM tu není.
    await expect(stranka.getByText("Poznámky")).toHaveCount(0);
    await stranka.context().close();
  });
});

test.describe("co klient mění (část 3)", () => {
  test("upraví jméno, telefon a souhlas; tým to vidí na kartě", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Úprava ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka).toHaveURL(/\/ucet$/);

    await stranka.getByRole("link", { name: "Upravit údaje a heslo" }).click();
    await expect(stranka).toHaveURL(/\/ucet\/profil$/);
    const noveJmeno = `Klient Přejmenovaný ${pripona()}`;
    await stranka.getByLabel("Jméno a příjmení").fill(noveJmeno);
    await stranka.getByLabel("Telefon (nepovinné)").fill("601234567");
    await stranka.getByRole("radio", { name: "Souhlasím", exact: true }).check();
    await stranka.getByRole("button", { name: "Uložit údaje" }).click();
    await cekejNaUspech(stranka, "Údaje jsou uložené.");
    await bezVodorovnehoPosuvu(stranka);

    await otevriAzUvidis(
      stranka,
      "/ucet",
      stranka.getByRole("heading", { name: `Dobrý den, ${noveJmeno}` }),
    );
    await expect(stranka.getByText("+420 601 234 567")).toBeVisible();
    await expect(stranka.getByText(/^Udělen /)).toBeVisible();

    // V CRM se změna projevila na kartě klienta.
    const [karta] = await dotaz<{ name: string; phone: string; souhlas: boolean }>(
      `SELECT "name", "phone", "consentMarketingAt" IS NOT NULL AS "souhlas"
         FROM "clients" WHERE "id" = $1`,
      [klient.id],
    );
    expect(karta).toEqual({ name: noveJmeno, phone: "+420 601 234 567", souhlas: true });
    await stranka.context().close();
  });

  test("změna hesla odhlásí a platí jen nové heslo", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Nové Heslo ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka).toHaveURL(/\/ucet$/);

    const noveHeslo = `${randomBytes(12).toString("base64url")}-Cc3`;
    await otevriAzUvidis(stranka, "/ucet/profil", stranka.getByLabel("Současné heslo"));
    await stranka.getByLabel("Současné heslo").fill(klient.heslo);
    await stranka.getByLabel("Nové heslo", { exact: true }).fill(noveHeslo);
    await stranka.getByLabel("Nové heslo ještě jednou").fill(noveHeslo);
    await stranka.getByRole("button", { name: "Změnit heslo" }).click();

    await expect(stranka).toHaveURL(/\/ucet\/prihlaseni\?heslo=zmeneno/);
    await expect(stranka.getByText(/Heslo je změněné/)).toBeVisible();

    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka.getByText("Nesprávný e-mail nebo heslo.")).toBeVisible();
    await prihlasKlienta(stranka, klient.email, noveHeslo);
    await expect(stranka).toHaveURL(/\/ucet$/);
    await stranka.context().close();
  });

  test("dvoufázové ověření: zapnout, přihlášení pak chce kód", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Dvoufázové ${pripona()}`);
    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka).toHaveURL(/\/ucet$/);

    await otevriAzUvidis(
      stranka,
      "/ucet/profil",
      stranka.getByLabel("Pro potvrzení zadejte svoje heslo"),
    );
    await stranka.getByLabel("Pro potvrzení zadejte svoje heslo").fill(klient.heslo);
    await stranka.getByRole("button", { name: "Zapnout" }).click();

    const klicNaObrazovce = stranka.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
    await expect(klicNaObrazovce).toBeVisible();
    const klic = (await klicNaObrazovce.textContent()) ?? "";
    await stranka.getByLabel("Kód z aplikace").fill(kodZKlice(klic));
    await stranka.getByRole("button", { name: "Potvrdit a zapnout" }).click();
    await cekejNaUspech(stranka, "Dvoufázové ověření je zapnuté.");

    // Nové přihlášení v čistém prohlížeči (stará stránka se po zapnutí
    // ještě obnovuje a srazila by se s přechodem): po hesle se ptá na kód.
    await stranka.context().close();
    const druha = await prohlizecKlienta(browser);
    await prihlasKlienta(druha, klient.email, klient.heslo);
    await expect(druha.getByText(/Heslo sedí/)).toBeVisible();
    await druha.getByLabel("Kód z aplikace").fill(kodZKlice(klic, 30));
    await druha.getByRole("button", { name: "Ověřit a přihlásit" }).click();
    await expect(druha).toHaveURL(/\/ucet$/);
    await druha.context().close();
  });
});

test.describe("cena objednávky ze chvíle nákupu", () => {
  test("zdražení v ceníku starou objednávku nezmění", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Cena ${pripona()}`);
    // Vlastní produkt, ať změna ceny neovlivní souběžné testy.
    const nazev = `E2E Kurz ceny ${pripona()}`;
    const [produkt] = await dotaz<{ id: string }>(
      `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency", "updatedAt")
       SELECT gen_random_uuid()::text, $1, 'KURZ', 1000, "id", 'CZK', now()
         FROM "vat_rates" WHERE "rate" = 21 LIMIT 1
       RETURNING "id"`,
      [nazev],
    );
    const [objednavka] = await dotaz<{ id: string; number: string }>(
      `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                             "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, 'Test', $1, 'ZAPLACENO', 'CZK', now(), now(), now())
       RETURNING "id", "number"`,
      [klient.id],
    );
    // Cenu položce doplní databáze sama (spouštěč `order_items_cena`).
    await dotaz(
      `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
       VALUES (gen_random_uuid()::text, $1, $2, 1)`,
      [objednavka!.id, produkt!.id],
    );

    // Zdražení v ceníku až po objednávce.
    await dotaz(`UPDATE "products" SET "netPrice" = 5000 WHERE "id" = $1`, [produkt!.id]);

    const stranka = await prohlizecKlienta(browser);
    await prihlasKlienta(stranka, klient.email, klient.heslo);
    await expect(stranka).toHaveURL(/\/ucet$/);
    const radek = stranka
      .getByRole("list", { name: "Moje objednávky" })
      .getByRole("listitem")
      .filter({ hasText: `Objednávka ${objednavka!.number}` });
    // 1 000 Kč bez DPH + 21 % = 1 210 Kč, ne 6 050 Kč podle nového ceníku.
    await expect(radek).toContainText(/1\s210,00\sKč/);
    await expect(radek).not.toContainText(/6\s050/);
    await stranka.context().close();
  });
});
