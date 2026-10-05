import { expect, test, type Page } from "@playwright/test";

import { dotaz, pripona, stavPrihlaseni } from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Content-Security-Policy (Jakub, 5. 10. 2026, `src/lib/csp.ts`).
 *
 * Hlídá se:
 * - **stránka hlavičku má** a klíč ke skriptům je při každém načtení jiný,
 * - **cizí skript v obsahu stránky se nespustí** (typický útok: obsluha
 *   `onerror` vložená do textu),
 * - **naše vlastní obrazovky prohlížeč nic nezablokuje** — CRM, karta
 *   klienta s náhledem přílohy, klientská část s videem v lekci. Kdyby
 *   pravidla byla moc přísná, aplikace by přestala reagovat nebo by
 *   zmizelo video či náhled.
 *
 * Zablokování se pozná podle události `securitypolicyviolation`, kterou
 * prohlížeč vyvolá v dokumentu, kde k němu došlo. Sbírá se od začátku
 * načtení (`addInitScript`), takže chytí i skripty z prvního vykreslení.
 */

declare global {
  interface Window {
    __zablokovano?: string[];
    __spusteno?: boolean;
  }
}

async function hlidejZablokovani(page: Page) {
  await page.addInitScript(() => {
    window.__zablokovano = [];
    document.addEventListener("securitypolicyviolation", (udalost) => {
      window.__zablokovano!.push(`${udalost.effectiveDirective} ${udalost.blockedURI}`);
    });
  });
}

async function zablokovano(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__zablokovano ?? []);
}

/**
 * Otevře obrazovku, počká na nadpis nebo formulář (přihlášení nadpis
 * nemá, jen titulek karty) a ověří, že se nic nezablokovalo.
 */
async function otevriBezZablokovani(page: Page, adresa: string) {
  await page.goto(adresa);
  await expect(page.locator("h1, h2, form").first()).toBeVisible();
  await page.waitForLoadState("load");
  expect(await zablokovano(page), `zablokováno na ${adresa}`).toEqual([]);
}

test.describe("hlavička", () => {
  test("stránka ji má a klíč ke skriptům se pokaždé mění", async ({ request }) => {
    const klic = async () => {
      const odpoved = await request.get("/prihlaseni");
      expect(odpoved.status()).toBe(200);
      const csp = odpoved.headers()["content-security-policy"] ?? "";
      const skripty = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
      // Skripty jen s klíčem — nikdy volně vložené.
      expect(skripty).toContain("'strict-dynamic'");
      expect(skripty).not.toContain("'unsafe-inline'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'self'");
      return /'nonce-([^']+)'/.exec(skripty)?.[1];
    };

    const prvni = await klic();
    const druhy = await klic();
    expect(prvni).toBeTruthy();
    expect(druhy).toBeTruthy();
    expect(prvni).not.toBe(druhy);
  });

  test("klientská část ji má taky", async ({ request }) => {
    const odpoved = await request.get("/ucet/prihlaseni");
    expect(odpoved.headers()["content-security-policy"]).toMatch(/script-src [^;]*'nonce-/);
  });
});

test.describe("cizí skript", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("vložený do stránky se nespustí", async ({ page }) => {
    await hlidejZablokovani(page);
    await page.goto("/dashboard");
    await expect(page.locator("h1").first()).toBeVisible();

    // Tak by vypadal útok přes text, který by se omylem vložil jako HTML.
    await page.evaluate(() => {
      const misto = document.createElement("div");
      misto.innerHTML = '<img src="/neexistuje.png" onerror="window.__spusteno = true">';
      document.body.append(misto);
    });

    await expect.poll(() => zablokovano(page)).toContainEqual(expect.stringMatching(/^script-src/));
    expect(await page.evaluate(() => window.__spusteno)).toBeUndefined();
  });
});

test.describe("obrazovky CRM", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("prohlížeč na nich nic nezablokuje", async ({ page }) => {
    test.setTimeout(120_000);
    await hlidejZablokovani(page);
    for (const adresa of [
      "/dashboard",
      "/klienti",
      "/objednavky",
      "/produkty",
      "/vzdelavani",
      "/sprava",
      "/nastaveni",
      "/smartemailing",
      "/profil",
    ]) {
      await otevriBezZablokovani(page, adresa);
    }
  });

  test("karta klienta s nahranou přílohou a náhledem", async ({ page }) => {
    const [klient] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES ($1, $2, $3, 'landing-page', now())
       RETURNING "id"`,
      [
        `e2ecsp${pripona()}${pripona()}`,
        `CSP Klient ${pripona()}`,
        `csp-${pripona()}@example.test`,
      ],
    );
    const nazev = `Ukazka ${pripona()}.pdf`;

    await hlidejZablokovani(page);
    await otevriBezZablokovani(page, `/klienti/${klient!.id}`);

    await page.getByRole("button", { name: /Přílohy \(0\)/ }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: nazev,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4\n% csp\n%%EOF\n`),
    });
    await expect(page.getByText("Soubor je nahraný.")).toBeVisible();

    await page.getByRole("button", { name: `Náhled ${nazev}` }).click();
    const nahled = page.locator(`iframe[title="${nazev}"]`);
    await expect(nahled).toBeVisible();
    // Rám s přílohou se načte z naší adresy — `frame-src 'self'`.
    await expect.poll(async () => (await nahled.elementHandle())?.contentFrame()).toBeTruthy();
    expect(await zablokovano(page)).toEqual([]);
  });
});

test.describe("klientská část", () => {
  test("přehled, kurzy a lekce s videem nic nezablokují", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`CSP Klient ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz CSP ${pripona()}`);
    await zaplatProdukt(klient.id, produkt);

    const [kurz] = await dotaz<{ id: string }>(
      `INSERT INTO "courses" ("id", "productId", "title", "publishedAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())
       RETURNING "id"`,
      [`e2ekurz${pripona()}${pripona()}`, produkt, `Kurz CSP ${pripona()}`],
    );
    const [lekce] = await dotaz<{ id: string }>(
      `INSERT INTO "course_lessons" ("id", "courseId", "title", "body", "videoUrl", "position", "updatedAt")
       VALUES ($1, $2, 'Lekce s videem', 'Text lekce.', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 1, now())
       RETURNING "id"`,
      [`e2elekce${pripona()}${pripona()}`, kurz!.id],
    );

    const page = await prohlizecKlienta(browser);
    await hlidejZablokovani(page);
    await prihlasKlienta(page, klient.email, klient.heslo);
    expect(await zablokovano(page)).toEqual([]);

    await otevriBezZablokovani(page, "/ucet/kurzy");
    await otevriBezZablokovani(page, `/ucet/lekce/${lekce!.id}`);
    // Přehrávač je povolený jen z YouTube bez cookies (`frame-src`).
    await expect(page.locator('iframe[title="Video: Lekce s videem"]')).toHaveAttribute(
      "src",
      /^https:\/\/www\.youtube-nocookie\.com\//,
    );
    await otevriBezZablokovani(page, "/ucet/profil");
    await page.context().close();
  });
});

test.describe("bez přihlášení", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("přihlášení a texty nic nezablokují", async ({ page }) => {
    await hlidejZablokovani(page);
    for (const adresa of ["/prihlaseni", "/zapomenute-heslo", "/ucet/prihlaseni", "/ucet/zasady"]) {
      await otevriBezZablokovani(page, adresa);
    }
  });
});
