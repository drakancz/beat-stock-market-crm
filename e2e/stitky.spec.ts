import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
} from "./pomocne";
import { zalozKlientaSUctem } from "./pomocne-klient";

/**
 * Štítky, uložené filtry a hromadné akce (Fáze 5B, Jakub 11. 10. 2026).
 *
 * - **Seznam štítků spravuje jen administrátor** (Nastavení → Štítky);
 *   uživatel ho neuloží ani přímým voláním akce.
 * - Klientům štítky přidává a odebírá každý přihlášený (karta i hromadně),
 *   odebrání se potvrzuje.
 * - Filtry: štítek, přístup, platnost; uložený filtr je osobní,
 *   administrátor ho sdílí s týmem.
 * - Hromadně: štítek, stažení do tabulky, zpráva (jen administrátor,
 *   jen klientům s účtem).
 */

async function zalozStitek(nazev: string, barva = "ZNACKA") {
  const [stitek] = await dotaz<{ id: string }>(
    `INSERT INTO "client_tags" ("id", "name", "color", "updatedAt")
     VALUES ($1, $2, $3::"TagColor", now()) RETURNING "id"`,
    [`e2estitek${pripona()}${pripona()}`, nazev, barva],
  );
  return stitek!.id;
}

/** Klient bez účtu do klientské části. */
async function zalozKlienta(jmeno: string) {
  const [klient] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
     VALUES ($1, $2, $3, 'landing-page', now()) RETURNING "id"`,
    [`e2e${pripona()}${pripona()}`, jmeno, `stitky-${pripona()}@example.test`],
  );
  return klient!.id;
}

async function pocetSeStitkem(tagId: string): Promise<number> {
  const [radek] = await dotaz<{ pocet: number }>(
    `SELECT count(*)::int AS "pocet" FROM "client_tag_links" WHERE "tagId" = $1`,
    [tagId],
  );
  return radek!.pocet;
}

/** Vybere všechny klienty v seznamu (hlavička tabulky). */
async function vyberVse(page: Page) {
  await page.getByRole("checkbox", { name: "Vybrat všechny klienty v seznamu" }).click();
}

test.describe("štítky očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("založí, přejmenuje a smaže štítek; uživatel ho ani přímo nezaloží", async ({
    page,
    browser,
  }) => {
    const nazev = `VIP ${pripona()}`;
    await page.goto("/nastaveni/stitky");
    await page.getByRole("button", { name: "Nový štítek" }).click();
    const okno = page.getByRole("dialog", { name: "Nový štítek" });
    await okno.getByLabel("Název").fill(nazev);
    await okno.getByRole("radio", { name: "Zelená" }).check();
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Uložit" }).click(),
    ]);
    await cekejNaUspech(page, `Štítek je založený: ${nazev}.`);
    await expect(
      page.getByRole("list", { name: "Štítky" }).getByText(nazev, { exact: true }),
    ).toBeVisible();

    // Stejný název podruhé neprojde.
    await page.getByRole("button", { name: "Nový štítek" }).click();
    const druhe = page.getByRole("dialog", { name: "Nový štítek" });
    await druhe.getByLabel("Název").fill(nazev.toLowerCase());
    await druhe.getByRole("button", { name: "Uložit" }).click();
    await expect(druhe.getByText(/už v seznamu je/)).toBeVisible();
    await druhe.getByRole("button", { name: "Zrušit" }).click();

    await page.getByRole("button", { name: `Upravit štítek: ${nazev}` }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit štítek" });
    await uprava.getByLabel("Název").fill(`${nazev} plus`);
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Štítek je uložený: ${nazev} plus.`);

    await page.getByRole("button", { name: `Smazat štítek: ${nazev} plus` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat štítek" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: ${nazev} plus.`);

    // Uživatel zopakuje volání akce s jiným názvem — server ho odmítne.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const zkusil = `Podvržený ${pripona()}`;
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      // Tělo je formulář — vymění se jen název.
      data: (akce.postData() ?? "").replace(nazev, zkusil),
    });
    const [nalezen] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "client_tags" WHERE "name" = $1`,
      [zkusil],
    );
    expect(nalezen?.pocet, "uživatel nesmí štítek založit").toBe(0);
    await tym.close();
  });

  test(
    "hromadně přidá a odebere štítek, stáhne tabulku, pošle zprávu jen klientům s účtem",
    { tag: "@telefon" },
    async ({ page }) => {
      const p = pripona();
      const stitek = `Hromadný ${p}`;
      const tagId = await zalozStitek(stitek);
      const sUctem = await zalozKlientaSUctem(`Hromadně ${p} Jedna`);
      await zalozKlientaSUctem(`Hromadně ${p} Dva`);
      await zalozKlienta(`Hromadně ${p} Tři`);

      await otevriAzUvidis(
        page,
        `/klienti?hledat=${encodeURIComponent(`Hromadně ${p}`)}`,
        page.getByRole("link", { name: `Hromadně ${p} Tři` }),
      );
      await vyberVse(page);
      const lista = page.getByRole("toolbar", { name: "Hromadné akce" });
      await expect(lista.getByText("Vybráno: 3 klienti")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      await lista.getByRole("button", { name: "Přidat štítek" }).click();
      const pridani = page.getByRole("dialog", { name: "Přidat štítek" });
      await pridani.getByRole("radio", { name: stitek }).check();
      await pridani.getByRole("button", { name: `Přidat ${stitek} 3 klientům` }).click();
      await cekejNaUspech(page, `Štítek ${stitek} je přidaný 3 klientům.`);
      expect(await pocetSeStitkem(tagId)).toBe(3);

      // Tabulka (CSV): tlačítko posílá vybrané formulářem. Safari na iPhonu
      // CSV otevírá po svém, proto se soubor ověřuje přímým dotazem stejného tvaru.
      await expect(lista.getByRole("button", { name: "Stáhnout do tabulky" })).toBeVisible();
      const vybrani = await dotaz<{ id: string }>(
        `SELECT "id" FROM "clients" WHERE "name" LIKE $1`,
        [`Hromadně ${p}%`],
      );
      const tabulka = await page.request.post("/klienti/export", {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: vybrani.map((k) => `id=${encodeURIComponent(k.id)}`).join("&"),
      });
      expect(tabulka.status()).toBe(200);
      expect(tabulka.headers()["content-disposition"]).toMatch(/klienti-\d{4}-\d{2}-\d{2}\.csv/);
      const obsah = await tabulka.text();
      expect(obsah).toContain(`Hromadně ${p} Jedna`);
      expect(obsah).toContain(stitek);

      // Z cizí stránky (jiný Origin) se tabulka nevydá.
      const cizi = await page.request.post("/klienti/export", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://cizi-stranka.example",
        },
        data: vybrani.map((k) => `id=${encodeURIComponent(k.id)}`).join("&"),
      });
      expect(cizi.status()).toBe(403);

      // Zpráva: dva mají účet, třetí se přeskočí.
      await lista.getByRole("button", { name: "Poslat zprávu" }).click();
      const zprava = page.getByRole("dialog", { name: "Poslat zprávu vybraným" });
      await zprava.getByLabel("Text zprávy").fill(`Hromadná novinka ${p}`);
      await zprava.getByRole("button", { name: /Poslat/ }).click();
      await cekejNaUspech(page, /Zpráva je uložená u 2 klientů.*přeskočeno: 1/);
      const [zpravy] = await dotaz<{ pocet: number }>(
        `SELECT count(*)::int AS "pocet" FROM "client_messages" WHERE "clientId" = $1`,
        [sUctem.id],
      );
      expect(zpravy?.pocet).toBe(1);

      // Odebrání štítku je potvrzení mazání. Výběr po akci zůstává.
      await expect(lista.getByText("Vybráno: 3 klienti")).toBeVisible();
      await lista.getByRole("button", { name: "Odebrat štítek" }).click();
      const odebrani = page.getByRole("dialog", { name: "Odebrat štítek" });
      await expect(odebrani.getByText(/Tuhle akci nelze vzít zpět/)).toBeVisible();
      await odebrani.getByRole("radio", { name: stitek }).check();
      await odebrani.getByRole("button", { name: new RegExp(`Odebrat ${stitek}`) }).click();
      await cekejNaUspech(page, `Štítek ${stitek} je odebraný 3 klientům.`);
      expect(await pocetSeStitkem(tagId)).toBe(0);
    },
  );

  test("uložený filtr sdílí s týmem", async ({ page, browser }) => {
    const p = pripona();
    const nazev = `Sdílený filtr ${p}`;
    await page.goto(`/klienti?pristup=POVOLEN&hledat=${p}`);
    await page.getByRole("button", { name: "Uložit filtr" }).click();
    const okno = page.getByRole("dialog", { name: "Uložit filtr" });
    await okno.getByLabel("Název filtru").fill(nazev);
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Filtr je uložený: ${nazev}.`);

    await page.getByRole("button", { name: `Sdílet s týmem: ${nazev}` }).click();
    await cekejNaUspech(page, `Filtr ${nazev} teď vidí celý tým.`);

    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const kolega = await tym.newPage();
    await kolega.goto("/klienti");
    const uloz = kolega.getByRole("list", { name: "Uložené filtry" });
    await expect(uloz.getByRole("link", { name: nazev })).toBeVisible();
    // Cizí sdílený filtr kolega nesmaže ani nesdílí.
    await expect(uloz.getByRole("button", { name: `Smazat filtr: ${nazev}` })).toHaveCount(0);
    await expect(uloz.getByRole("button", { name: /Sdílet s týmem/ })).toHaveCount(0);
    await tym.close();

    await page.getByRole("button", { name: `Smazat filtr: ${nazev}` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat filtr" });
    await expect(potvrzeni.getByText(/Zmizí celému týmu/)).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: filtr ${nazev}.`);
  });
});

test.describe("štítky očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "na kartě přidá a odebere štítek, filtruje podle něj a uloží si filtr",
    { tag: "@telefon" },
    async ({ page }) => {
      const p = pripona();
      const stitek = `Zájem ${p}`;
      const tagId = await zalozStitek(stitek, "JANTAR");
      const s = await zalozKlienta(`Štítkový ${p} Ano`);
      await zalozKlienta(`Štítkový ${p} Ne`);

      const odpoved = await page.goto("/nastaveni/stitky");
      expect(odpoved?.status()).toBe(404);

      await page.goto(`/klienti/${s}`);
      const stitky = page.getByRole("group", { name: "Štítky klienta" });
      await stitky.getByRole("button", { name: "Přidat štítek" }).click();
      await page.getByRole("list", { name: "Nabídka štítků" }).getByText(stitek).click();
      await cekejNaUspech(page, `Štítek ${stitek} je přidaný 1 klientovi.`);
      await expect(stitky.getByText(stitek, { exact: true })).toBeVisible();

      // Filtr podle štítku najde jen klienta se štítkem.
      await page.goto(`/klienti?hledat=${encodeURIComponent(`Štítkový ${p}`)}`);
      await vyber(page, "Štítek", stitek);
      await expect(page).toHaveURL(new RegExp(`stitek=${tagId}`));
      await expect(page.getByRole("link", { name: `Štítkový ${p} Ne` })).toHaveCount(0);
      await expect(page.getByRole("link", { name: `Štítkový ${p} Ano` })).toBeVisible();

      const filtr = `Můj filtr ${p}`;
      await page.getByRole("button", { name: "Uložit filtr" }).click();
      const okno = page.getByRole("dialog", { name: "Uložit filtr" });
      await okno.getByLabel("Název filtru").fill(filtr);
      await okno.getByRole("button", { name: "Uložit" }).click();
      await cekejNaUspech(page, `Filtr je uložený: ${filtr}.`);
      // Uživatel filtr sdílet nemůže, smazat svůj ano.
      const uloz = page.getByRole("list", { name: "Uložené filtry" });
      await expect(uloz.getByRole("button", { name: /Sdílet s týmem/ })).toHaveCount(0);

      await otevriAzUvidis(page, "/klienti", uloz.getByRole("link", { name: filtr }));
      await uloz.getByRole("link", { name: filtr }).click();
      await expect(page.getByRole("link", { name: `Štítkový ${p} Ano` })).toBeVisible();
      await expect(page.getByRole("link", { name: `Štítkový ${p} Ne` })).toHaveCount(0);

      await uloz.getByRole("button", { name: `Smazat filtr: ${filtr}` }).click();
      await page
        .getByRole("dialog", { name: "Smazat filtr" })
        .getByRole("button", { name: "Smazat" })
        .click();
      await cekejNaUspech(page, `Smazáno: filtr ${filtr}.`);

      // Odebrání na kartě s potvrzením.
      await otevriAzUvidis(
        page,
        `/klienti/${s}`,
        stitky.getByRole("button", { name: `Odebrat štítek ${stitek}` }),
      );
      await stitky.getByRole("button", { name: `Odebrat štítek ${stitek}` }).click();
      const potvrzeni = page.getByRole("dialog", { name: "Odebrat štítek" });
      await expect(potvrzeni.getByText(/Tuhle akci nelze vzít zpět/)).toBeVisible();
      await potvrzeni.getByRole("button", { name: "Odebrat" }).click();
      await cekejNaUspech(page, `Štítek ${stitek} je odebraný 1 klientovi.`);
      expect(await pocetSeStitkem(tagId)).toBe(0);
      await bezVodorovnehoPosuvu(page);
    },
  );
});
