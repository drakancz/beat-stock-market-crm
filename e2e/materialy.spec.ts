import { expect, test, type APIRequestContext } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, pripona, stavPrihlaseni } from "./pomocne";
import {
  lekceKurzu,
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozKurz,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Materiály ke stažení u lekcí (Jakub, 3. 11. 2026, docs/funkce/vzdelavani.md).
 *
 * | Kdo           | Smí                                                         |
 * | ------------- | ----------------------------------------------------------- |
 * | klient        | stáhnout u otevřené lekce zaplaceného kurzu                 |
 * | uživatel      | v CRM vidět a stáhnout, nenahraje ani nesmaže               |
 * | administrátor | navíc nahrát a smazat (s potvrzením)                        |
 * | nepřihlášený  | nic                                                         |
 *
 * Soubory jdou jen do soukromého úložiště S3 (v testech S3Mock), povolené
 * jsou PDF, Word, Excel a obrázky.
 */

/** Nejmenší soubor, který kontrola obsahu uzná jako PDF. */
function pdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
}

/** Kurz s jednou lekcí; vrací id kurzu, lekce a produktu. */
async function kurzSLekci(nazevLekce: string) {
  const produkt = await zalozProdukt(`E2E Materiály ${pripona()}`);
  const kurzId = await zalozKurz(produkt, `Kurz s materiály ${pripona()}`, [nazevLekce]);
  const [lekceId] = await lekceKurzu(kurzId);
  return { produkt, kurzId, lekceId: lekceId! };
}

/** Nahraje materiál k lekci přímo přes adresu (jako formulář). */
async function nahraj(request: APIRequestContext, lekceId: string, nazev: string, obsah: Buffer) {
  return request.post(`/api/soubory?typ=LEKCE&id=${encodeURIComponent(lekceId)}`, {
    headers: { "Content-Type": "application/pdf", "X-Nazev": encodeURIComponent(nazev) },
    data: obsah,
  });
}

test.describe("materiály v CRM", () => {
  test("administrátor nahraje, uvidí a smaže materiál s potvrzením", async ({ browser }) => {
    const { kurzId, lekceId } = await kurzSLekci("Lekce s podklady");
    const nazev = `Pracovní list ${pripona()}.pdf`;
    const obsah = pdf(`material ${pripona()}`);

    const kontext = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const page = await kontext.newPage();
    await page.goto(`/vzdelavani/kurzy/${kurzId}`);
    await page.getByRole("button", { name: "Materiály (0)" }).click();
    const okno = page.getByRole("dialog", { name: "Materiály: Lekce s podklady" });
    await expect(okno.getByText("Povolené jsou PDF, Word, Excel a obrázky.").first()).toBeVisible();
    // Materiály jdou jen do soukromého úložiště — varování o veřejném není.
    await expect(okno.getByText(/veřejnou adresu/)).toHaveCount(0);

    // Zvuk k lekci nepatří — odmítne už prohlížeč.
    await okno.locator('input[type="file"]').setInputFiles({
      name: "nahravka.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("ID3 neni to zvuk"),
    });
    await expect(page.getByText(/Tenhle typ souboru nahrát nejde/)).toBeVisible();

    await okno
      .locator('input[type="file"]')
      .setInputFiles({ name: nazev, mimeType: "application/pdf", buffer: obsah });
    await expect(page.getByText("Soubor je nahraný.")).toBeVisible();
    await expect(okno.getByText(nazev, { exact: true })).toBeVisible();

    const [radek] = await dotaz<{ id: string; storage: string; ownerType: string }>(
      `SELECT "id", "storage"::text, "ownerType"::text FROM "attachments"
       WHERE "ownerId" = $1 AND "deletedAt" IS NULL`,
      [lekceId],
    );
    expect(radek!.storage).toBe("S3");
    expect(radek!.ownerType).toBe("LEKCE");

    await okno.getByRole("button", { name: `Smazat ${nazev}` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat soubor" });
    await expect(potvrzeni.getByText(nazev)).toBeVisible();
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await expect(page.getByText(`Smazáno: ${nazev}`)).toBeVisible();
    await expect
      .poll(async () => (await kontext.request.get(`/api/soubory/${radek!.id}`)).status())
      .toBe(404);
    await kontext.close();
  });

  test("server odmítne typ, který k materiálům nepatří", async ({ browser }) => {
    const { lekceId } = await kurzSLekci("Lekce bez videa");
    const kontext = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const odpoved = await kontext.request.post(
      `/api/soubory?typ=LEKCE&id=${encodeURIComponent(lekceId)}`,
      {
        headers: { "Content-Type": "text/plain", "X-Nazev": "poznamky.txt" },
        data: Buffer.from("obyčejný text"),
      },
    );
    expect(odpoved.status()).toBe(400);
    const zapsane = await dotaz(`SELECT 1 FROM "attachments" WHERE "ownerId" = $1`, [lekceId]);
    expect(zapsane).toHaveLength(0);
    await kontext.close();
  });

  test("uživatel materiál vidí a stáhne, ale nenahraje ani nesmaže", async ({ browser }) => {
    const { kurzId, lekceId } = await kurzSLekci("Lekce pro tým");
    const nazev = `Podklad ${pripona()}.pdf`;
    const obsah = pdf(`tym ${pripona()}`);

    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    expect((await nahraj(admin.request, lekceId, nazev, obsah)).status()).toBe(201);
    await admin.close();

    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await kontext.newPage();
    await page.goto(`/vzdelavani/kurzy/${kurzId}`);
    await page.getByRole("button", { name: "Materiály (1)" }).click();
    const okno = page.getByRole("dialog", { name: "Materiály: Lekce pro tým" });
    await expect(okno.getByText(nazev, { exact: true })).toBeVisible();
    await expect(okno.getByRole("button", { name: "Nahrát soubor" })).toHaveCount(0);
    await expect(okno.getByRole("button", { name: `Smazat ${nazev}` })).toHaveCount(0);

    const [radek] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "attachments" WHERE "ownerId" = $1`,
      [lekceId],
    );
    const stazeni = await kontext.request.get(`/api/soubory/${radek!.id}`);
    expect(stazeni.status()).toBe(200);
    expect(Buffer.compare(await stazeni.body(), obsah)).toBe(0);

    // Ani přímým voláním: nahrání 404 (jako u neexistujícího záznamu).
    expect((await nahraj(kontext.request, lekceId, "cizi.pdf", pdf("x"))).status()).toBe(404);
    await kontext.close();
  });
});

test.describe("materiály v klientské části", () => {
  test(
    "klient se zaplaceným kurzem materiál stáhne, cizí, zamčená a nepřihlášený ne",
    { tag: "@telefon" },
    async ({ browser }) => {
      const { produkt, lekceId } = await kurzSLekci("Lekce ke stažení");
      const nazev = `Slovníček ${pripona()}.pdf`;
      const obsah = pdf(`klient ${pripona()}`);

      const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
      expect((await nahraj(admin.request, lekceId, nazev, obsah)).status()).toBe(201);
      await admin.close();

      const klient = await zalozKlientaSUctem(`Klient Materiály ${pripona()}`);
      await zaplatProdukt(klient.id, produkt);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.goto(`/ucet/lekce/${lekceId}`);
      await expect(page.getByRole("heading", { name: "Materiály ke stažení" })).toBeVisible();
      const odkaz = page.getByRole("link", { name: new RegExp(nazev.replace(".", "\\.")) });
      await expect(odkaz).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      const adresa = (await odkaz.getAttribute("href"))!;
      expect(adresa).toMatch(/^\/ucet\/materialy\//);
      const stazeni = await page.request.get(adresa);
      expect(stazeni.status()).toBe(200);
      expect(stazeni.headers()["content-type"]).toBe("application/pdf");
      expect(stazeni.headers()["cache-control"]).toContain("no-store");
      expect(Buffer.compare(await stazeni.body(), obsah)).toBe(0);

      // Zamčená lekce (otevře se až za měsíc): materiál se nevydá.
      await dotaz(
        `UPDATE "course_lessons" SET "unlockOn" = now() + interval '30 days' WHERE "id" = $1`,
        [lekceId],
      );
      expect((await page.request.get(adresa)).status()).toBe(404);
      await dotaz(`UPDATE "course_lessons" SET "unlockOn" = NULL WHERE "id" = $1`, [lekceId]);
      await page.context().close();

      // Klient bez kurzu dostane 404, jako by soubor neexistoval.
      const cizi = await zalozKlientaSUctem(`Klient Bez Kurzu ${pripona()}`);
      const ciziPage = await prohlizecKlienta(browser);
      await prihlasKlienta(ciziPage, cizi.email, cizi.heslo);
      expect((await ciziPage.request.get(adresa)).status()).toBe(404);
      await ciziPage.context().close();

      // Nepřihlášeného pošle proxy na přihlášení klienta.
      const anonym = await prohlizecKlienta(browser);
      const bezPrihlaseni = await anonym.request.get(adresa, { maxRedirects: 0 });
      expect(bezPrihlaseni.status()).toBe(307);
      expect(bezPrihlaseni.headers()["location"]).toContain("/ucet/prihlaseni");
      await anonym.context().close();
    },
  );

  test("lekce bez materiálů kartu nemá", { tag: "@telefon" }, async ({ browser }) => {
    const { produkt, lekceId } = await kurzSLekci("Lekce bez podkladů");
    const klient = await zalozKlientaSUctem(`Klient Bez Materiálů ${pripona()}`);
    await zaplatProdukt(klient.id, produkt);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.goto(`/ucet/lekce/${lekceId}`);
    await expect(page.getByRole("heading", { name: "Lekce bez podkladů" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Materiály ke stažení" })).toHaveCount(0);
    await page.context().close();
  });
});
