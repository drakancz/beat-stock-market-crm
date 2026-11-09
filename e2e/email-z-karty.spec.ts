import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  SOUBOR_UCTU,
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  pripona,
  prihlas,
  stavPrihlaseni,
  vyber,
  zalozUzivatele,
} from "./pomocne";

/**
 * E-mail z karty klienta se šablonami (Fáze 5D, Jakub 5. 11. 2026).
 *
 * - **Poslat smí každý přihlášený**, i klientovi bez souhlasu s marketingem
 *   (okno upozorní).
 * - **Šablony spravuje jen administrátor** (Nastavení → Šablony e-mailů);
 *   uživatel dostane 404 a neuloží ji ani přímým voláním akce.
 * - E-mail se uloží do historie, objeví se na časové ose a odpověď jde
 *   tomu, kdo psal (`Reply-To`). Limit 30 za hodinu na člověka.
 * - V testech pošta končí v Mailpitu.
 */

const MAILPIT = "http://mailpit:8025";

interface ZpravaMailpitu {
  Subject: string;
  Text: string;
  From: { Name: string; Address: string };
  ReplyTo: { Address: string }[];
}

async function zpravyPro(komu: string): Promise<ZpravaMailpitu[]> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()),
  );
}

/** Klient (e-mail má každý — je povinný), volitelně se souhlasem s marketingem. */
async function zalozKlienta(jmeno: string, { souhlas = false } = {}) {
  const adresa = `email-karta-${pripona()}@example.test`;
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "consentMarketingAt", "updatedAt")
     VALUES ($1, $2, $3, 'landing-page', CASE WHEN $4::boolean THEN now() END, now())
     RETURNING "id"`,
    [`e2e${pripona()}${pripona()}`, jmeno, adresa, souhlas],
  );
  return { id: klient!.id, email: adresa };
}

async function zalozSablonu(nazev: string) {
  const [sablona] = await dotaz<{ id: string }>(
    `INSERT INTO "email_templates" ("id", "name", "subject", "body", "updatedAt")
     VALUES ($1, $2, 'Dotaz pro {jmeno}', E'Dobrý den, {jmeno},\\n\\nposíláme odpověď.', now())
     RETURNING "id"`,
    [`e2esablona${pripona()}${pripona()}`, nazev],
  );
  return sablona!.id;
}

async function otevriOkno(page: Page, klientId: string) {
  await page.goto(`/klienti/${klientId}`);
  await page.getByRole("button", { name: /^Poslat email/ }).click();
  return page.getByRole("dialog", { name: "Poslat email" });
}

test.describe("šablony e-mailů — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("založí, upraví a smaže šablonu; uživatel ji ani přímo nezaloží", async ({
    page,
    browser,
  }) => {
    const nazev = `Šablona ${pripona()}`;
    await page.goto("/nastaveni/sablony");
    await page.getByRole("button", { name: "Nová šablona" }).click();
    const okno = page.getByRole("dialog", { name: "Nová šablona" });
    await okno.getByLabel("Název šablony").fill(nazev);
    await okno.getByLabel("Předmět e-mailu").fill("Dobrý den, {jmeno}");
    await okno.getByLabel("Text e-mailu").fill("Dobrý den,\n\ntest šablony.");
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Uložit" }).click(),
    ]);
    await cekejNaUspech(page, `Šablona je založená: ${nazev}.`);
    const seznam = page.getByRole("list", { name: "Šablony e-mailů" });
    await expect(seznam.getByText(nazev, { exact: true })).toBeVisible();

    // Stejný název podruhé neprojde, okno zůstane otevřené s chybou.
    await page.getByRole("button", { name: "Nová šablona" }).click();
    const druhe = page.getByRole("dialog", { name: "Nová šablona" });
    await druhe.getByLabel("Název šablony").fill(nazev.toUpperCase());
    await druhe.getByLabel("Předmět e-mailu").fill("Cokoli");
    await druhe.getByLabel("Text e-mailu").fill("Cokoli");
    await druhe.getByRole("button", { name: "Uložit" }).click();
    await expect(druhe.getByText(/už v seznamu je/)).toBeVisible();
    await druhe.getByRole("button", { name: "Zrušit" }).click();

    await page.getByRole("button", { name: `Upravit šablonu: ${nazev}` }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit šablonu" });
    await expect(uprava.getByLabel("Předmět e-mailu")).toHaveValue("Dobrý den, {jmeno}");
    await uprava.getByLabel("Název šablony").fill(`${nazev} plus`);
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Šablona je uložená: ${nazev} plus.`);

    await page.getByRole("button", { name: `Smazat šablonu: ${nazev} plus` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat šablonu" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: ${nazev} plus.`);
    await expect(seznam.getByText(`${nazev} plus`, { exact: true })).toHaveCount(0);

    // Uživatel zopakuje volání akce s jiným názvem — server ho odmítne.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const zkusil = `Podvržená ${pripona()}`;
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      data: (akce.postData() ?? "").replace(nazev, zkusil),
    });
    const [nalezena] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "email_templates" WHERE "name" = $1`,
      [zkusil],
    );
    expect(nalezena?.pocet, "uživatel nesmí šablonu založit").toBe(0);
    await tym.close();
  });
});

test.describe("e-mail z karty — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "pošle e-mail se šablonou, dorazí do Mailpitu a je v historii i na časové ose",
    { tag: "@telefon" },
    async ({ page }) => {
      const p = pripona();
      const jmeno = `Emailová ${p}`;
      const sablona = `Odpověď ${p}`;
      await zalozSablonu(sablona);
      const klient = await zalozKlienta(jmeno);

      // Šablony uživatel nespravuje.
      const odpoved = await page.goto("/nastaveni/sablony");
      expect(odpoved?.status()).toBe(404);

      const okno = await otevriOkno(page, klient.id);
      await expect(okno.getByText(klient.email)).toBeVisible();
      // Bez souhlasu s marketingem poslat jde, okno jen upozorní.
      await expect(okno.getByText(/nemá souhlas s marketingem/)).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      await vyber(page, "Šablona", sablona);
      // Za {jmeno} se doplnilo jméno klienta.
      await expect(okno.getByLabel("Předmět")).toHaveValue(`Dotaz pro ${jmeno}`);
      await expect(okno.getByLabel("Text")).toHaveValue(new RegExp(`^Dobrý den, ${jmeno},`));
      await okno.getByLabel("Text").fill(`Dobrý den,\n\nupravený text ${p}.`);
      await okno.getByRole("button", { name: "Odeslat" }).click();
      await cekejNaUspech(page, `E-mail odešel: ${jmeno}.`);

      // Dorazil s upraveným textem a odpověď jde kolegovi, ne systému.
      const ucty = JSON.parse(await readFile(SOUBOR_UCTU, "utf8")) as Record<
        string,
        { id: string }
      >;
      const [autor] = await dotaz<{ email: string; name: string }>(
        `SELECT "email", "name" FROM "users" WHERE "id" = $1`,
        [ucty.uzivatel!.id],
      );
      await expect(async () => {
        const zpravy = await zpravyPro(klient.email);
        expect(zpravy).toHaveLength(1);
        expect(zpravy[0]!.Subject).toBe(`Dotaz pro ${jmeno}`);
        expect(zpravy[0]!.Text).toContain(`upravený text ${p}.`);
        expect(zpravy[0]!.From.Name).toContain(autor!.name);
        expect(zpravy[0]!.ReplyTo.map((a) => a.Address)).toEqual([autor!.email]);
      }).toPass({ timeout: 15_000 });

      // Historie v okně: předmět, autor, odesláno.
      await page.getByRole("button", { name: "Poslat email (1)" }).click();
      const historie = page.getByRole("dialog", { name: "Poslat email" });
      await expect(historie.getByText(`Dotaz pro ${jmeno}`)).toBeVisible();
      await expect(historie.getByText(/odesláno$/)).toBeVisible();
      await historie.getByText(`Dotaz pro ${jmeno}`).click();
      await expect(historie.getByText(`upravený text ${p}.`)).toBeVisible();
      await page.keyboard.press("Escape");

      // Časová osa.
      await page.getByRole("button", { name: "Časová osa" }).click();
      const osa = page.getByRole("dialog", { name: "Časová osa" });
      await expect(osa.getByText(`E-mail: Dotaz pro ${jmeno}`)).toBeVisible();

      // Do auditu jde jen to, že e-mail odešel — ne předmět ani text.
      const audit = await dotaz<{ after: unknown }>(
        `SELECT "after" FROM "audit_log" WHERE "entityId" = $1 AND "action" = 'klient.email-odeslan'`,
        [klient.id],
      );
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0]!.after)).not.toContain("upravený text");
      expect(JSON.stringify(audit[0]!.after)).not.toContain("Dotaz pro");
    },
  );

  test("klient se souhlasem upozornění nemá", async ({ page }) => {
    const klient = await zalozKlienta(`Souhlasná ${pripona()}`, { souhlas: true });
    const okno = await otevriOkno(page, klient.id);
    await expect(okno.getByLabel("Předmět")).toBeVisible();
    await expect(okno.getByText(/nemá souhlas s marketingem/)).toHaveCount(0);
  });
});

test("po 30 e-mailech za hodinu další neodejde", async ({ browser }) => {
  // Vlastní účet — limit se počítá na člověka a sdílený účet by
  // zablokoval ostatní testy.
  const uzivatel = await zalozUzivatele("uzivatel", "Limit");
  const klient = await zalozKlienta(`Limitová ${pripona()}`);
  await dotaz(
    `INSERT INTO "client_emails" ("id", "clientId", "authorId", "subject", "body", "status")
     SELECT gen_random_uuid()::text, $1, $2, 'Starší', 'Text', 'ODESLANO'
     FROM generate_series(1, 30)`,
    [klient.id, uzivatel!.id],
  );

  const kontext = await browser.newContext();
  const page = await kontext.newPage();
  await prihlas(page, uzivatel!.email, uzivatel.heslo);
  await page.waitForURL(/\/dashboard/);

  const okno = await otevriOkno(page, klient.id);
  await okno.getByLabel("Předmět").fill("Jednatřicátý");
  await okno.getByLabel("Text").fill("Dobrý den.");
  await okno.getByRole("button", { name: "Odeslat" }).click();
  await expect(okno.getByText(/za poslední hodinu odešlo 30 e-mailů/)).toBeVisible();
  expect(await zpravyPro(klient.email)).toHaveLength(0);
  await kontext.close();
});
