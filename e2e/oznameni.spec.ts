import { randomBytes } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { zahesluj } from "../src/lib/hesla";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
} from "./pomocne";

/**
 * Upozornění klientům a zprávy od administrátora (krok 3A, Jakub 4. 10. 2026).
 *
 * Co se tu hlídá:
 *
 * - **Zprávu klientovi pošle jen administrátor**, a jen klientovi s aktivním
 *   účtem; historii na kartě vidí každý přihlášený. Klient ji vidí jen sám.
 * - Klient bez povolených oznámení dostane upozornění **e-mailem** — v testech
 *   nejsou klíče k doručovacím službám (`VAPID_*` prázdné), takže každé
 *   upozornění jde do Mailpitu. Samotné oznámení v telefonu se zkouší ručně.
 * - Vypínač v Mém profilu vypne i e-maily.
 * - Zaplacení objednávky, povolení přístupu a konec členství (plánovač).
 * - Plánovač bez klíče nic neudělá a ke každému konci pošle jen jedno
 *   upozornění.
 * - Ikony, manifesty a service worker jdou stáhnout bez přihlášení.
 */

const MAILPIT = "http://mailpit:8025";
const ZDROJ = "landing-page";

/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

async function zalozKlientaSUctem(jmeno: string) {
  const email = `oznameni-${pripona()}@example.test`;
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, $4, now())
     RETURNING "id"`,
    [`e2e${pripona()}${pripona()}`, jmeno, email, ZDROJ],
  );
  const heslo = randomBytes(18).toString("base64url");
  await dotaz(
    `INSERT INTO "client_accounts"
       ("id", "clientId", "passwordHash", "passwordSetAt", "invitedAt", "updatedAt")
     VALUES ($1, $2, $3, now(), now(), now())`,
    [`e2e${pripona()}${pripona()}`, klient!.id, await zahesluj(heslo)],
  );
  return { id: klient!.id, email, name: jmeno, heslo };
}

async function prohlizecKlienta(browser: Browser): Promise<Page> {
  const kontext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await kontext.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  return kontext.newPage();
}

async function prihlasKlienta(page: Page, email: string, heslo: string) {
  await page.goto("/ucet/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill(heslo);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("heading", { name: /Dobrý den/ })).toBeVisible();
}

interface Email {
  Subject: string;
  Text: string;
}

/** Všechny e-maily na adresu, nejnovější první. */
async function emaily(komu: string): Promise<Email[]> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()),
  ) as Promise<Email[]>;
}

/** Počká, až na adresu dorazí e-mail s daným předmětem, a vrátí ho. */
async function cekejNaEmail(komu: string, predmet: string): Promise<Email> {
  let nalezeny: Email | undefined;
  await expect(async () => {
    nalezeny = (await emaily(komu)).find((e) => e.Subject === predmet);
    expect(nalezeny).toBeTruthy();
  }).toPass({ timeout: 20_000 });
  return nalezeny!;
}

/** Zpráva do klientské části zapsaná přímo do databáze. */
async function zapisZpravu(clientId: string, text: string) {
  await dotaz(
    `INSERT INTO "client_messages" ("id", "clientId", "text", "delivery")
     VALUES ($1, $2, $3, 'EMAIL')`,
    [`e2e${pripona()}${pripona()}`, clientId, text],
  );
}

test.describe("zprávy od administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor pošle zprávu, klient ji dostane e-mailem a vidí ve Zprávách", async ({
    page,
    browser,
  }) => {
    const klient = await zalozKlientaSUctem(`Zpráva Klient ${pripona()}`);
    const text = `Dobrý den, posíláme novinku ${pripona()}.`;

    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: "Zprávy (0)" }).click();
    const okno = page.getByRole("dialog", { name: "Zprávy klientovi" });
    await expect(okno.getByText("Klient zatím žádnou zprávu nedostal.")).toBeVisible();
    await okno.getByLabel("Nová zpráva").fill(text);
    await okno.getByRole("button", { name: "Poslat zprávu" }).click();
    await cekejNaUspech(page, /přišla mu e-mailem/);
    await expect(okno.getByText(text)).toBeVisible();
    await expect(okno.getByText(/doručeno e-mailem · zatím nepřečteno/)).toBeVisible();

    // Náhradní e-mail s celým textem a odkazem do Zpráv.
    const email = await cekejNaEmail(klient.email, "Zpráva od Beat Stock Market");
    expect(email.Text).toContain(text);
    expect(email.Text).toMatch(/\/ucet\/zpravy/);

    // Klient vidí odznak s počtem a zprávu, otevřením ji přečte.
    const klientska = await prohlizecKlienta(browser);
    await prihlasKlienta(klientska, klient.email, klient.heslo);
    await expect(klientska.getByRole("link", { name: "Zprávy, nepřečtené: 1" })).toBeVisible();
    await klientska.getByRole("link", { name: "Zprávy, nepřečtené: 1" }).click();
    await expect(klientska.getByRole("heading", { name: "Zprávy" })).toBeVisible();
    await expect(klientska.getByText(text)).toBeVisible();
    await expect(klientska.getByText("nová")).toBeVisible();
    await bezVodorovnehoPosuvu(klientska);

    // Na kartě je vidět, že je přečtená.
    await otevriAzUvidis(
      page,
      `/klienti/${klient.id}`,
      page.getByRole("button", { name: "Zprávy (1)" }),
    );
    await page.getByRole("button", { name: "Zprávy (1)" }).click();
    await expect(page.getByRole("dialog").getByText(/· přečteno /)).toBeVisible();

    await klientska.context().close();
  });

  test("klient s vypnutými upozorněními dostane zprávu jen do klientské části", async ({
    page,
    browser,
  }) => {
    const klient = await zalozKlientaSUctem(`Zpráva Vypnuto ${pripona()}`);

    const klientska = await prohlizecKlienta(browser);
    await prihlasKlienta(klientska, klient.email, klient.heslo);
    await klientska.goto("/ucet/profil");
    await expect(klientska.getByText("Upozornění", { exact: true })).toBeVisible();
    await klientska.getByRole("button", { name: "Vypnout upozornění" }).click();
    await cekejNaUspech(klientska, "Upozornění jsou vypnutá.");
    await expect(klientska.getByRole("button", { name: "Zapnout upozornění" })).toBeVisible();

    const text = `Tichá zpráva ${pripona()}`;
    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: "Zprávy (0)" }).click();
    const okno = page.getByRole("dialog", { name: "Zprávy klientovi" });
    await expect(okno.getByText(/má upozornění vypnutá/)).toBeVisible();
    await okno.getByLabel("Nová zpráva").fill(text);
    await okno.getByRole("button", { name: "Poslat zprávu" }).click();
    await cekejNaUspech(page, /uvidí ji po přihlášení/);
    await expect(okno.getByText(/jen v klientské části/)).toBeVisible();

    // E-mail nepřišel ani po chvíli.
    await page.waitForTimeout(2_000);
    expect(await emaily(klient.email)).toHaveLength(0);

    await klientska.goto("/ucet/zpravy");
    await expect(klientska.getByText(text)).toBeVisible();

    // Zapnutí vrátí upozornění.
    await klientska.goto("/ucet/profil");
    await klientska.getByRole("button", { name: "Zapnout upozornění" }).click();
    await cekejNaUspech(klientska, "Upozornění jsou zapnutá.");

    await klientska.context().close();
  });

  test("klientovi bez účtu zprávu poslat nejde", async ({ page }) => {
    const jmeno = `Zpráva Bez Účtu ${pripona()}`;
    const [klient] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES ($1, $2, $3, $4, now())
       RETURNING "id"`,
      [`e2e${pripona()}${pripona()}`, jmeno, `bez-uctu-${pripona()}@example.test`, ZDROJ],
    );

    await page.goto(`/klienti/${klient!.id}`);
    await expect(page.getByRole("heading", { name: jmeno })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Zprávy/ })).toHaveCount(0);
  });

  test("klient vidí jen svoje zprávy", async ({ browser }) => {
    const ja = await zalozKlientaSUctem(`Zprávy Já ${pripona()}`);
    const cizi = await zalozKlientaSUctem(`Zprávy Cizí ${pripona()}`);
    const ciziText = `Cizí zpráva ${pripona()}`;
    await zapisZpravu(cizi.id, ciziText);

    const klientska = await prohlizecKlienta(browser);
    await prihlasKlienta(klientska, ja.email, ja.heslo);
    await klientska.goto("/ucet/zpravy");
    await expect(klientska.getByText("Zatím jsme vám žádnou zprávu neposlali.")).toBeVisible();
    await expect(klientska.getByText(ciziText)).toHaveCount(0);
    await klientska.context().close();
  });
});

test.describe("zprávy očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("uživatel historii vidí, ale poslat zprávu nemůže", async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Zpráva Uživatel ${pripona()}`);
    const text = `Starší zpráva ${pripona()}`;
    await zapisZpravu(klient.id, text);

    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: "Zprávy (1)" }).click();
    const okno = page.getByRole("dialog", { name: "Zprávy klientovi" });
    await expect(okno.getByText(text)).toBeVisible();
    await expect(okno.getByLabel("Nová zpráva")).toHaveCount(0);
    await expect(okno.getByRole("button", { name: "Poslat zprávu" })).toHaveCount(0);
  });
});

test.describe("upozornění z CRM", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("zaplacení objednávky a povolení přístupu přijdou klientovi e-mailem", async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Upozornění Platba ${pripona()}`);
    const [objednavka] = await dotaz<{ number: string }>(
      `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'NOVA', 'CZK', now())
       RETURNING "number"`,
      [`Kurz ${pripona()}`, klient.id],
    );
    const cislo = objednavka!.number;

    const radek = page.getByRole("row").filter({ hasText: cislo });
    await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(cislo)}`, radek);
    await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
    await cekejNaUspech(page, /Stav objednávky je změněný/);

    const platba = await cekejNaEmail(klient.email, "Objednávka je zaplacená");
    expect(platba.Text).toContain(cislo);

    const radekKlienta = page.getByRole("row").filter({ hasText: klient.name });
    await otevriAzUvidis(page, `/klienti?hledat=${encodeURIComponent(klient.name)}`, radekKlienta);
    await vyber(page, `Přístup do programu: ${klient.name}`, /^Povolen$/);
    await cekejNaUspech(page, /Přístup do programu je povolený/);

    await cekejNaEmail(klient.email, "Přístup do programu je povolený");
  });
});

test.describe("denní plánovač", () => {
  // Rozhraní, ne obrazovka — stačí jeden prohlížeč.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  test("bez klíče a se špatným klíčem nic neudělá", async ({ request }) => {
    const hlavicky = { "x-forwarded-for": nahodnaAdresa() };
    expect((await request.post("/api/planovac", { headers: hlavicky })).status()).toBe(401);
    expect(
      (
        await request.post("/api/planovac", {
          headers: { ...hlavicky, Authorization: "Bearer tohle-neni-spravny-klic-planovace-x" },
        })
      ).status(),
    ).toBe(401);
    // GET neexistuje.
    expect((await request.get("/api/planovac", { headers: hlavicky })).status()).toBe(405);
  });

  test("upozorní na konec členství týden předem a v den konce, každé jen jednou", async ({
    request,
  }) => {
    const tyden = await zalozKlientaSUctem(`Konec Týden ${pripona()}`);
    const dnes = await zalozKlientaSUctem(`Konec Dnes ${pripona()}`);
    const [produkt] = await dotaz<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "products" WHERE "deletedAt" IS NULL ORDER BY "name" LIMIT 1`,
    );

    // Začátek pražského dne — tak ukládá konec platnosti `platnost.ts`.
    const prazskyDen = (dnu: number) =>
      `(date_trunc('day', now() AT TIME ZONE 'Europe/Prague') + interval '${dnu} days') AT TIME ZONE 'Europe/Prague'`;
    for (const [klient, dnu] of [
      [tyden, 7],
      [dnes, 0],
    ] as const) {
      await dotaz(
        `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
         VALUES ($1, $2, $3, ${prazskyDen(dnu)}, now())`,
        [`e2e${pripona()}${pripona()}`, klient.id, produkt!.id],
      );
    }

    const spust = () =>
      request.post("/api/planovac", {
        headers: {
          Authorization: `Bearer ${KLIC_PLANOVACE}`,
          "x-forwarded-for": nahodnaAdresa(),
        },
      });

    const prvni = await spust();
    expect(prvni.status()).toBe(200);

    const tydenni = await cekejNaEmail(tyden.email, "Členství brzy končí");
    expect(tydenni.Text).toContain(produkt!.name);
    expect(tydenni.Text).toContain("zbývá 7 dní");
    await cekejNaEmail(dnes.email, "Členství dnes končí");

    // Druhé spuštění téhož dne už nic nepošle.
    expect((await spust()).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(await emaily(tyden.email)).toHaveLength(1);
    expect(await emaily(dnes.email)).toHaveLength(1);
  });
});

test.describe("aplikace na ploše", () => {
  test("ikony, manifesty a service worker jdou stáhnout bez přihlášení", async ({ request }) => {
    const crm = await request.get("/aplikace.webmanifest");
    expect(crm.status()).toBe(200);
    expect(crm.headers()["content-type"]).toContain("application/manifest+json");
    const manifestCrm = await crm.json();
    expect(manifestCrm.start_url).toBe("/dashboard");

    const klient = await request.get("/ucet/aplikace.webmanifest");
    expect(klient.status()).toBe(200);
    const manifestKlienta = await klient.json();
    expect(manifestKlienta.start_url).toBe("/ucet");
    expect(manifestKlienta.scope).toBe("/ucet");
    expect(manifestKlienta.icons).toHaveLength(3);

    for (const ikona of manifestKlienta.icons as { src: string }[]) {
      expect((await request.get(ikona.src)).status()).toBe(200);
    }
    expect((await request.get("/apple-icon.png")).status()).toBe(200);

    const sw = await request.get("/sw-klient.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect(await sw.text()).toContain("showNotification");
  });

  test("klientská část a CRM odkazují každá na svůj manifest", async ({ browser }) => {
    const stranka = await prohlizecKlienta(browser);
    await stranka.goto("/ucet/prihlaseni");
    await expect(stranka.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/ucet/aplikace.webmanifest",
    );
    await stranka.goto("/prihlaseni");
    await expect(stranka.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/aplikace.webmanifest",
    );
    await stranka.context().close();
  });

  test("Upozornění v Mém profilu klienta nepřečnívají na telefonu", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Profil Upozornění ${pripona()}`);
    const klientska = await prohlizecKlienta(browser);
    await prihlasKlienta(klientska, klient.email, klient.heslo);
    await klientska.goto("/ucet/profil");
    await expect(klientska.getByText("Upozornění", { exact: true })).toBeVisible();
    await expect(klientska.getByText("Upozornění jsou")).toBeVisible();
    await bezVodorovnehoPosuvu(klientska);
    await klientska.context().close();
  });
});
