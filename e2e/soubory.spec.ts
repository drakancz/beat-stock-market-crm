import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  dotaz,
  otevriAzUvidis,
  pripona,
  SOUBOR_UCTU,
  stavPrihlaseni,
  zalozUzivatele,
  type RoleTestu,
} from "./pomocne";

/**
 * Přílohy u profilu a klienta (CLAUDE.md → Nahrávání souborů).
 *
 * **Od 4. 10. 2026 se nahrávání zkouší doopravdy** — do místního úložiště
 * S3Mock v Dockeru (bucket `prilohy-test`), ven nic neodchází. Hlídá se:
 *
 * - nahrání, náhled, stažení a smazání s potvrzením,
 * - podvržený soubor (text s příponou `.pdf`) se nepřijme,
 * - **k cizímu souboru se nikdo nedostane** — ani přímo na adresu,
 *   kterou se soubory vydávají, ani nahráním k cizímu záznamu,
 * - u S3 se neukazuje varování o veřejném úložišti UploadThingu,
 * - na telefonu nic nepřečnívá.
 *
 * Řádky souborů zapsané přímo SQL mají úložiště `UPLOADTHING`, které
 * v testech nastavené není — výdej pak skončí `503` až po kontrole
 * oprávnění (bez oprávnění by to bylo `404`).
 */

/** Nejmenší soubor, který kontrola obsahu uzná jako PDF. */
function pdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
}

/** Zkušební klient. Od 22. 9. 2026 se klienti nikomu nepřiřazují. */
async function zalozKlienta() {
  const [zdroj] = await dotaz<{ id: string }>(`SELECT "id" FROM "client_sources" LIMIT 1`);
  const [klient] = await dotaz<{ id: string; name: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, $4, now())
     RETURNING "id", "name"`,
    [
      `e2eklient${pripona()}${pripona()}`,
      `Příloha Klient ${pripona()}`,
      `e2e-klient-${pripona()}@beatstockmarket.test`,
      zdroj.id,
    ],
  );
  return klient;
}

/** Zkušební řádek souboru u klienta. */
async function zalozSouborKlienta(klientId: string, uploadedById: string) {
  const [soubor] = await dotaz<{ id: string }>(
    `INSERT INTO "attachments"
       ("id", "key", "name", "mimeType", "size", "ownerType", "ownerId", "uploadedById")
     VALUES ($1, $2, $3, 'application/pdf', 2048, 'KLIENT', $4, $5)
     RETURNING "id"`,
    [
      `e2esoubk${pripona()}${pripona()}`,
      `e2e-${pripona()}-vypis.pdf`,
      `Výpis ${pripona()}.pdf`,
      klientId,
      uploadedById,
    ],
  );
  return soubor.id;
}

/** Zkušební řádek souboru u uživatele. Klíč je vymyšlený — k úložišti se nesahá. */
async function zalozSoubor(ownerId: string, uploadedById: string) {
  const [soubor] = await dotaz<{ id: string }>(
    `INSERT INTO "attachments"
       ("id", "key", "name", "mimeType", "size", "ownerType", "ownerId", "uploadedById")
     VALUES ($1, $2, $3, 'application/pdf', 1024, 'UZIVATEL', $4, $5)
     RETURNING "id"`,
    [
      `e2esoubor${pripona()}${pripona()}`,
      `e2e-${pripona()}-smlouva.pdf`,
      `Smlouva ${pripona()}.pdf`,
      ownerId,
      uploadedById,
    ],
  );
  return soubor.id;
}

for (const role of ["admin", "uzivatel"] as const satisfies RoleTestu[]) {
  test.describe(`${role}: přílohy ve vlastním profilu`, () => {
    test.use({ storageState: stavPrihlaseni(role) });

    test("sekce je vidět a soubory jde nahrávat", async ({ page }) => {
      await page.goto("/profil");

      await expect(page.getByText("Přílohy", { exact: true })).toBeVisible();
      // Úložiště S3 je v testech nastavené — tlačítko je vidět, varování
      // o veřejném úložišti UploadThingu ne.
      await expect(page.getByRole("button", { name: "Nahrát soubor" })).toBeVisible();
      await expect(page.getByText("veřejnou adresu")).toHaveCount(0);
    });

    test("na telefonu nic nepřečnívá", async ({ page }) => {
      await page.goto("/profil");
      await expect(page.getByText("Přílohy", { exact: true })).toBeVisible();
      await bezVodorovnehoPosuvu(page);
    });
  });
}

test.describe("administrátor vidí přílohy kolegy", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("sekce je na profilu kolegy ve Správě", async ({ page }) => {
    const kolega = await zalozUzivatele("uzivatel", "Prilohy");
    expect(kolega.id, "zkušební účet se nezaložil").toBeTruthy();

    // `otevriAzUvidis()` místo holého `goto()`: při plné sadě běží tři
    // prohlížeče najednou a stránka občas naběhla dřív, než byl čerstvě
    // založený účet vidět — vracela pak 404 (21. 9. 2026).
    await otevriAzUvidis(
      page,
      `/sprava/uzivatele/${kolega.id}`,
      page.getByText("Přílohy", { exact: true }),
    );

    await expect(page.getByText(`Soubory u účtu ${kolega.name}`)).toBeVisible();
  });

  test("soubor kolegy administrátorovi projde přes oprávnění", async ({ request }) => {
    const kolega = await zalozUzivatele("uzivatel", "Pristup");
    const souborId = await zalozSoubor(kolega.id, kolega.id);

    const odpoved = await request.get(`/api/soubory/${souborId}`);

    // 503 = oprávnění prošlo a zastavilo se to až na nenastaveném
    // úložišti. Kdyby oprávnění neprošlo, vrátilo by se 404.
    expect(odpoved.status()).toBe(503);
  });
});

test.describe("k cizímu souboru se nikdo nedostane", () => {
  test("obchodník dostane 404 u souboru kolegy", async ({ browser }) => {
    const kolega = await zalozUzivatele("uzivatel", "Cizi");
    const souborId = await zalozSoubor(kolega.id, kolega.id);

    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const odpoved = await kontext.request.get(`/api/soubory/${souborId}`);
    await kontext.close();

    expect(odpoved.status()).toBe(404);
  });

  test("nepřihlášený dostane 401", async ({ request }) => {
    const kolega = await zalozUzivatele("uzivatel", "Neprihlaseny");
    const souborId = await zalozSoubor(kolega.id, kolega.id);

    const odpoved = await request.get(`/api/soubory/${souborId}`);

    expect(odpoved.status()).toBe(401);
  });

  test("neexistující soubor vrátí 404, ne chybu", async ({ browser }) => {
    const kontext = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const odpoved = await kontext.request.get("/api/soubory/neexistuje");
    await kontext.close();

    expect(odpoved.status()).toBe(404);
  });
});

/**
 * Přílohy u klienta (Jakub, 21. 9. 2026).
 *
 * Rozsah se řídí viditelností klienta — a tu od 22. 9. 2026 mají všichni
 * stejnou, protože se klienti nikomu nepřiřazují. Zbývá tedy ověřit, že
 * sekce funguje a že k **neexistujícímu** souboru se nikdo nedostane.
 */
test.describe("přílohy u klienta", () => {
  test("uživatel otevře přílohy klienta", async ({ browser }) => {
    const klient = await zalozKlienta();

    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await kontext.newPage();
    await page.goto(`/klienti/${klient.id}`);

    // Tlačítko je mezi Objednávky a Upravit (od 23. 9. 2026).
    await page.getByRole("button", { name: /Přílohy \(0\)/ }).click();

    await expect(page.getByText("Zatím tu není žádný soubor.")).toBeVisible();
    // Se soukromým úložištěm S3 varování o UploadThingu nepatří ani sem.
    await expect(page.getByText("doklady totožnosti, smlouvy ani výpisy")).toHaveCount(0);
    await kontext.close();
  });

  test("soubor u klienta: nahrát, náhled, stáhnout, smazat s potvrzením", async ({ browser }) => {
    const klient = await zalozKlienta();
    const nazev = `Smlouva ${pripona()}.pdf`;
    const obsah = pdf(`obsah ${pripona()}`);

    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await kontext.newPage();
    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: /Přílohy \(0\)/ }).click();

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: nazev, mimeType: "application/pdf", buffer: obsah });
    await expect(page.getByText("Soubor je nahraný.")).toBeVisible();
    await expect(page.getByText(nazev, { exact: true })).toBeVisible();

    // V databázi je v úložišti S3, klíč nenese název souboru.
    const [radek] = await dotaz<{ id: string; storage: string; key: string; size: number }>(
      `SELECT "id", "storage"::text, "key", "size" FROM "attachments"
       WHERE "ownerId" = $1 AND "deletedAt" IS NULL`,
      [klient.id],
    );
    expect(radek!.storage).toBe("S3");
    expect(radek!.key).not.toContain("Smlouva");
    expect(radek!.size).toBe(obsah.byteLength);

    // Stažení přes CRM vrátí přesně to, co se nahrálo.
    const stazeni = await kontext.request.get(`/api/soubory/${radek!.id}`);
    expect(stazeni.status()).toBe(200);
    expect(stazeni.headers()["content-type"]).toBe("application/pdf");
    expect(Buffer.compare(await stazeni.body(), obsah)).toBe(0);

    // Náhled v okně.
    await page.getByRole("button", { name: `Náhled ${nazev}` }).click();
    await expect(page.locator(`iframe[title="${nazev}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Zavřít" }).last().click();

    // Smazání s potvrzovacím oknem.
    await page.getByRole("button", { name: `Smazat ${nazev}` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat soubor" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await expect(page.getByText(`Smazáno: ${nazev}`)).toBeVisible();

    // `expect.poll` zkusí dotaz znovu, když server zavře spojení, které
    // předtím přerušil náhled (ECONNRESET na Androidu, 4. 10. 2026).
    await expect
      .poll(async () => (await kontext.request.get(`/api/soubory/${radek!.id}`)).status())
      .toBe(404);
    await kontext.close();
  });

  test("podvržený soubor (text s příponou .pdf) se nepřijme", async ({ browser }) => {
    const klient = await zalozKlienta();
    const kontext = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const page = await kontext.newPage();
    await page.goto(`/klienti/${klient.id}`);
    await page.getByRole("button", { name: /Přílohy \(0\)/ }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "faktura.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("tohle neni pdf, jen text"),
    });
    await expect(page.getByText(/neodpovídá jeho příponě/)).toBeVisible();

    const zapsane = await dotaz(`SELECT 1 FROM "attachments" WHERE "ownerId" = $1`, [klient.id]);
    expect(zapsane).toHaveLength(0);
    await kontext.close();
  });
});

test.describe("nahrání k cizímu záznamu", () => {
  test("uživatel nenahraje soubor do profilu kolegy, nepřihlášený vůbec", async ({
    browser,
    request,
  }) => {
    const kolega = await zalozUzivatele("uzivatel", "CiziNahrani");
    const adresa = `/api/soubory?typ=UZIVATEL&id=${encodeURIComponent(kolega.id)}`;
    const pozadavek = {
      headers: { "Content-Type": "application/pdf", "X-Nazev": "cizi.pdf" },
      data: pdf("cizi"),
    };

    const uzivatel = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    expect((await uzivatel.request.post(adresa, pozadavek)).status()).toBe(404);
    await uzivatel.close();

    expect((await request.post(adresa, pozadavek)).status()).toBe(401);

    const zapsane = await dotaz(`SELECT 1 FROM "attachments" WHERE "ownerId" = $1`, [kolega.id]);
    expect(zapsane).toHaveLength(0);
  });

  test("k souboru u klienta se dostane i běžný uživatel", async ({ browser }) => {
    const ucty = JSON.parse(await readFile(SOUBOR_UCTU, "utf8")) as Record<string, { id: string }>;
    // Klienti se nikomu nepřiřazují, takže na něj vidí každý přihlášený.
    const klient = await zalozKlienta();
    const souborId = await zalozSouborKlienta(klient.id, ucty.admin.id);

    const uzivatel = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const odpoved = await uzivatel.request.get(`/api/soubory/${souborId}`);
    await uzivatel.close();
    // Oprávnění projde; zastaví se až na nenastaveném úložišti (503).
    expect(odpoved.status()).toBe(503);

    // Administrátor vidí všechny klienty — projde přes oprávnění a
    // zastaví se až na nenastaveném úložišti (503).
    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const povoleno = await admin.request.get(`/api/soubory/${souborId}`);
    await admin.close();
    expect(povoleno.status()).toBe(503);
  });
});
