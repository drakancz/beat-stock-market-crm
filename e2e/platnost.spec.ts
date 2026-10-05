import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  SOUBOR_UCTU,
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
  zalozKlientaFormularem,
} from "./pomocne";

/**
 * Platnost členství a úkol na prodloužení (Jakub, 24. 9. 2026).
 *
 * - Délka je u produktu v ceníku, mění ji administrátor.
 * - Platnost běží od zaplacení, další zaplacení navazuje.
 * - Vidí ji každý přihlášený (karta, seznam klientů), ručně upravit konec
 *   smí jen administrátor.
 * - Úkol „zavolat kvůli prodloužení" dostane člověk z Nastavení →
 *   Prodloužení, až je do konce míň dní, než je tam nastavené.
 *
 * Produkty a objednávky se zapisují SQL (objednávku v CRM nikdo
 * nezakládá); stav objednávky se ale přepíná v rozhraní — teprve tam se
 * platnost počítá.
 */

/** Dnešní den v Praze posunutý o měsíce a dny, jak ho píše CRM: `24. 9. 2027`. */
function datum({ mesicu = 0, dnu = 0 }: { mesicu?: number; dnu?: number }): string {
  const casti = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(Date.now() + dnu * 86_400_000))
    .split("-")
    .map(Number);
  const [rok, mesic, den] = casti as [number, number, number];

  const index = mesic - 1 + mesicu;
  const cilovyRok = rok + Math.floor(index / 12);
  const cilovyMesic = (index % 12) + 1;
  const dnuVMesici = new Date(Date.UTC(cilovyRok, cilovyMesic, 0)).getUTCDate();
  return `${Math.min(den, dnuVMesici)}. ${cilovyMesic}. ${cilovyRok}`;
}

/** Tentýž den ve tvaru pro políčko s datem (`RRRR-MM-DD`). */
function doPolicka(cesky: string): string {
  const [den, mesic, rok] = cesky.split(". ").map(Number);
  return `${rok}-${String(mesic).padStart(2, "0")}-${String(den).padStart(2, "0")}`;
}

/** Produkt v ceníku s danou platností (v měsících, `null` = neomezeno). */
async function zalozProdukt(
  nazev: string,
  mesicu: number | null,
  druh: "CLENSTVI" | "KURZ" | "KONZULTACE" = "CLENSTVI",
): Promise<string> {
  const [radek] = await dotaz<{ id: string }>(
    `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency",
                             "active", "validityMonths", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $3::"ProductKind", 1000,
             (SELECT "id" FROM "vat_rates" ORDER BY "order" LIMIT 1), 'CZK', true, $2, now(), now())
     RETURNING "id"`,
    [nazev, mesicu, druh],
  );
  return radek!.id;
}

/** Nová (nezaplacená) objednávka jednoho produktu. Vrací její číslo. */
async function zalozObjednavku(clientId: string, productId: string): Promise<string> {
  const [objednavka] = await dotaz<{ id: string; number: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Členství', $1, 'NOVA', 'CZK', now(), now())
     RETURNING "id", "number"`,
    [clientId],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1, now())`,
    [objednavka!.id, productId],
  );
  return objednavka!.number;
}

/** Administrátor přepne objednávku na Zaplaceno v sekci Objednávky. */
async function zaplat(page: Page, cislo: string) {
  const radek = page.getByRole("row").filter({ hasText: cislo });
  await otevriAzUvidis(page, `/objednavky?hledat=${encodeURIComponent(cislo)}`, radek);
  await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
  await cekejNaUspech(page, /Stav objednávky je změněný/);
}

/** Blok Platnost v Údajích na kartě klienta. */
function blokPlatnosti(page: Page) {
  return page.getByRole("region", { name: "Platnost" });
}

const idZAdresy = (adresa: string) => adresa.split("/").pop()!;

test.describe("platnost očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("délka se nastaví v ceníku", async ({ page }) => {
    const nazev = `Členství Ceník ${pripona()}`;
    await zalozProdukt(nazev, null);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);
    await expect(radek.getByText("neomezeno")).toBeVisible();

    await radek.getByRole("button", { name: `Upravit ${nazev}` }).click();
    const okno = page.getByRole("dialog", { name: "Upravit produkt" });
    // Neomezeno / Počet měsíců (Jakub, 27. 9. 2026).
    await okno.getByRole("radio", { name: "Počet měsíců" }).check();
    await okno.getByLabel("Měsíců", { exact: true }).fill("0");
    await okno.getByRole("button", { name: "Uložit změny" }).click();
    // Nula je chyba — produkt, který nekončí, má Neomezeno.
    await expect(okno.getByText(/aspoň 1 měsíc/)).toBeVisible();

    await okno.getByLabel("Měsíců", { exact: true }).fill("12");
    await okno.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `${nazev} je upravený.`);
    await expect(radek.getByText("12 měsíců")).toBeVisible();
  });

  /*
   * Kurz platí napořád (Jakub, 27. 9. 2026). Délka se u něj nenabízí
   * a z kurzu, který ji z dřívějška měl, zmizí i platnost u klientů.
   */
  test("kurz má vždy Neomezeno a zaplacený kurz nekončí", async ({ page }) => {
    const nazev = `Kurz Navzdy ${pripona()}`;
    // Kurz s délkou z doby před pravidlem — ověří se úklid při uložení.
    const produktId = await zalozProdukt(nazev, 12, "KURZ");
    const adresa = await zalozKlientaFormularem(page, `Kurz Klient ${pripona()}`);
    const cislo = await zalozObjednavku(idZAdresy(adresa), produktId);
    await zaplat(page, cislo);
    await otevriAzUvidis(page, adresa, blokPlatnosti(page).getByText(nazev));

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);
    await radek.getByRole("button", { name: `Upravit ${nazev}` }).click();

    const okno = page.getByRole("dialog", { name: "Upravit produkt" });
    await expect(okno.getByText("Neomezeno — doživotní přístup")).toBeVisible();
    await expect(okno.getByRole("radio", { name: "Počet měsíců" })).toHaveCount(0);
    await expect(okno.getByLabel("Měsíců", { exact: true })).toHaveCount(0);

    await okno.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `${nazev} je upravený.`);
    await expect(radek.getByText("neomezeno")).toBeVisible();

    // Klientovi kurz nekončí — v bloku Platnost už není.
    await page.goto(adresa);
    await expect(page.getByText("Kurz Klient").first()).toBeVisible();
    await expect(blokPlatnosti(page).getByText(nazev)).toHaveCount(0);
  });

  /*
   * Konzultace je jednorázová služba (Jakub, 28. 9. 2026) — platnost
   * nemá stejně jako kurz, jen se jinak jmenuje.
   */
  test("konzultace nemá platnost a zaplacená konzultace nekončí", async ({ page }) => {
    const nazev = `Konzultace Jednou ${pripona()}`;
    // Konzultace s délkou z doby před pravidlem — ověří se úklid při uložení.
    const produktId = await zalozProdukt(nazev, 1, "KONZULTACE");
    const adresa = await zalozKlientaFormularem(page, `Konzultace Klient ${pripona()}`);
    const cislo = await zalozObjednavku(idZAdresy(adresa), produktId);
    await zaplat(page, cislo);
    await otevriAzUvidis(page, adresa, blokPlatnosti(page).getByText(nazev));

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);
    await radek.getByRole("button", { name: `Upravit ${nazev}` }).click();

    const okno = page.getByRole("dialog", { name: "Upravit produkt" });
    await expect(okno.getByText("Bez platnosti — jednorázová služba")).toBeVisible();
    await expect(okno.getByRole("radio", { name: "Počet měsíců" })).toHaveCount(0);
    await expect(okno.getByLabel("Měsíců", { exact: true })).toHaveCount(0);

    await okno.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `${nazev} je upravený.`);
    await expect(radek.getByText("jednorázově")).toBeVisible();

    // Klientovi konzultace nekončí — v bloku Platnost už není.
    await page.goto(adresa);
    await expect(page.getByText("Konzultace Klient").first()).toBeVisible();
    await expect(blokPlatnosti(page).getByText(nazev)).toHaveCount(0);
  });

  test("změna druhu na konzultaci schová volbu měsíců", async ({ page }) => {
    const nazev = `Členství Na Konzultaci ${pripona()}`;
    await zalozProdukt(nazev, 3);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);
    await radek.getByRole("button", { name: `Upravit ${nazev}` }).click();

    const okno = page.getByRole("dialog", { name: "Upravit produkt" });
    await expect(okno.getByLabel("Měsíců", { exact: true })).toHaveValue("3");
    await vyber(page, "Druh", /^Konzultace$/);
    await expect(okno.getByText("Bez platnosti — jednorázová služba")).toBeVisible();

    await okno.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `${nazev} je upravený.`);
    await expect(radek.getByText("jednorázově")).toBeVisible();
  });

  test("změna druhu na kurz schová volbu měsíců", async ({ page }) => {
    const nazev = `Členství Na Kurz ${pripona()}`;
    await zalozProdukt(nazev, 6);

    const radek = page.getByRole("row").filter({ hasText: nazev });
    await otevriAzUvidis(page, "/produkty", radek);
    await radek.getByRole("button", { name: `Upravit ${nazev}` }).click();

    const okno = page.getByRole("dialog", { name: "Upravit produkt" });
    await expect(okno.getByLabel("Měsíců", { exact: true })).toHaveValue("6");
    await vyber(page, "Druh", /^Kurz$/);
    await expect(okno.getByText("Neomezeno — doživotní přístup")).toBeVisible();

    await okno.getByRole("button", { name: "Uložit změny" }).click();
    await cekejNaUspech(page, `${nazev} je upravený.`);
    await expect(radek.getByText("neomezeno")).toBeVisible();
  });

  test("zaplacení nastaví konec a další zaplacení na něj naváže", async ({ page }) => {
    const produkt = `Členství Rok ${pripona()}`;
    const produktId = await zalozProdukt(produkt, 12);
    const klient = `Platnost Klient ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);

    // Než klient zaplatí, platnost nemá.
    const prvni = await zalozObjednavku(idZAdresy(adresa), produktId);
    await page.goto(adresa);
    await expect(blokPlatnosti(page).getByText(produkt)).toHaveCount(0);

    await zaplat(page, prvni);
    const zaRok = datum({ mesicu: 12 });
    await otevriAzUvidis(page, adresa, blokPlatnosti(page).getByText(`do ${zaRok}`));
    await expect(blokPlatnosti(page).getByText(produkt)).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // Prodloužení před koncem nepřijde o zbytek — navazuje.
    const druha = await zalozObjednavku(idZAdresy(adresa), produktId);
    await zaplat(page, druha);
    const zaDvaRoky = datum({ mesicu: 24 });
    await otevriAzUvidis(page, adresa, blokPlatnosti(page).getByText(`do ${zaDvaRoky}`));

    // V seznamu klientů je sloupec Platnost do.
    const radek = page.getByRole("row").filter({ hasText: klient });
    await otevriAzUvidis(page, `/klienti?hledat=${encodeURIComponent(klient)}`, radek);
    await expect(page.getByRole("columnheader", { name: "Platnost do" })).toBeVisible();
    await expect(radek.getByText(zaDvaRoky)).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });

  test("konec jde ručně upravit a zapíše se do auditu", async ({ page }) => {
    const produkt = `Členství Ručně ${pripona()}`;
    await zalozProdukt(produkt, 12);
    const klient = `Platnost Rucne ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);

    const tlacitko = page.getByRole("button", { name: "Upravit platnost" });
    await otevriAzUvidis(page, adresa, tlacitko);
    await tlacitko.click();

    const okno = page.getByRole("dialog", { name: "Upravit platnost" });
    await vyber(page, "Produkt", produkt);
    const konec = datum({ mesicu: 2, dnu: 3 });
    await okno.getByLabel("Platí do (včetně)").fill(doPolicka(konec));
    await okno.getByRole("button", { name: "Uložit" }).click();

    await cekejNaUspech(page, `${produkt} platí do ${konec}.`);
    await expect(blokPlatnosti(page).getByText(`do ${konec}`)).toBeVisible();

    // Datum v minulosti platnost ukončí.
    await tlacitko.click();
    await vyber(page, "Produkt", produkt);
    const vcera = datum({ dnu: -1 });
    await okno.getByLabel("Platí do (včetně)").fill(doPolicka(vcera));
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `${produkt} platí do ${vcera}.`);
    await expect(blokPlatnosti(page).getByText(`skončilo ${vcera}`)).toBeVisible();

    const [zapis] = await dotaz<{ pocet: string }>(
      `SELECT count(*) AS "pocet" FROM "audit_log" WHERE "action" = 'platnost.upravena' AND "entityId" = $1`,
      [idZAdresy(adresa)],
    );
    expect(Number(zapis!.pocet)).toBe(2);
  });

  test("nastavení prodloužení vybere člověka a počet dní", async ({ page }) => {
    const ucty = JSON.parse(await readFile(SOUBOR_UCTU, "utf8")) as Record<
      string,
      { email: string }
    >;

    await page.goto("/nastaveni/prodlouzeni");
    await expect(page.getByText("Úkoly na prodloužení členství")).toBeVisible();

    // Všechny prohlížeče vybírají téhož člověka, takže si souběžné běhy
    // nastavení nepřepisují. Podle e-mailu — „E2E Uživatel" je v testovací
    // databázi víckrát, proto výběr e-mail ukazuje.
    await vyber(page, "Kdo prodloužení řeší", ucty.uzivatel!.email);
    await page.getByLabel("Kolik dní před koncem").fill("14");
    await page.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, /Nastavení prodloužení je uložené|Nic se nezměnilo|Uloženo/);
    await expect(page.getByText("Nikdo vybraný není")).toHaveCount(0);
  });
});

test.describe("platnost očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("vidí platnost, ale upravit ji nemůže", async ({ page }) => {
    const produkt = `Členství Pohled ${pripona()}`;
    const produktId = await zalozProdukt(produkt, 6);
    const klient = `Platnost Pohled ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);

    // Platnost zapsaná rovnou — zaplatit smí jen administrátor.
    const konec = datum({ mesicu: 6 });
    await dotaz(
      `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, ($3::date::text || ' 00:00 Europe/Prague')::timestamptz AT TIME ZONE 'UTC', now())`,
      [idZAdresy(adresa), produktId, doPolicka(konec)],
    );

    await otevriAzUvidis(page, adresa, blokPlatnosti(page).getByText(`do ${konec}`));
    await expect(page.getByRole("button", { name: "Upravit platnost" })).toHaveCount(0);
  });

  test("úkol na prodloužení se objeví v Mém dni a po zaplacení zmizí", async ({
    page,
    browser,
  }) => {
    const ucty = JSON.parse(await readFile(SOUBOR_UCTU, "utf8")) as Record<string, { id: string }>;

    // Prodloužení řeší zkušební uživatel — ve všech prohlížečích stejný.
    await dotaz(
      `INSERT INTO "company_settings" ("id", "renewalUserId", "renewalLeadDays", "updatedAt")
       VALUES ('firma', $1, 14, now())
       ON CONFLICT ("id") DO UPDATE SET "renewalUserId" = $1, "renewalLeadDays" = 14`,
      [ucty.uzivatel!.id],
    );

    const produkt = `Členství Končí ${pripona()}`;
    const produktId = await zalozProdukt(produkt, 12);
    const klient = `Platnost Konci ${pripona()}`;
    const adresa = await zalozKlientaFormularem(page, klient);

    // Administrátor ručně nastaví konec za pět dní — to je v lhůtě 14 dní.
    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const adminStranka = await admin.newPage();
    const konec = datum({ dnu: 5 });
    const tlacitko = adminStranka.getByRole("button", { name: "Upravit platnost" });
    await otevriAzUvidis(adminStranka, adresa, tlacitko);
    await tlacitko.click();
    await vyber(adminStranka, "Produkt", produkt);
    await adminStranka.getByLabel("Platí do (včetně)").fill(doPolicka(konec));
    await adminStranka.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(adminStranka, `${produkt} platí do ${konec}.`);

    // Úkol vznikne, když si uživatel otevře Dashboard.
    const ukol = page.getByText(`Prodloužení: ${produkt} končí ${konec}`);
    await otevriAzUvidis(page, "/dashboard", ukol);
    await expect(
      page.locator("li").filter({ has: ukol }).getByRole("link", { name: klient }),
    ).toBeVisible();

    // Druhé otevření nezaloží druhý úkol.
    await page.reload();
    await expect(ukol).toHaveCount(1);

    // Klient prodlouží — úkol se sám odškrtne a z Mého dne zmizí.
    const cislo = await zalozObjednavku(idZAdresy(adresa), produktId);
    await zaplat(adminStranka, cislo);
    await admin.close();

    await page.goto("/dashboard");
    await expect(page.getByText("Moje úkoly", { exact: true })).toBeVisible();
    await expect(ukol).toHaveCount(0);
  });
});

/**
 * Upozornění „členství skončilo, ale přístup je povolen" (Jakub,
 * 25. 9. 2026). Přístup se po konci sám nevypíná; seznam klientů takového
 * klienta podbarví a nahoře ukáže počet. Vidí každý přihlášený.
 * „Skončilo" = klientovi už nic neběží — kdo má jiný produkt ještě
 * platný, zvýrazněný není.
 */
test.describe("konec členství s povoleným přístupem", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  /** Klient s povoleným přístupem a platnostmi posunutými o dané dny od dneška. */
  async function klientSPlatnostmi(jmeno: string, posunyDnu: number[]) {
    const [zdroj] = await dotaz<{ id: string }>(`SELECT "id" FROM "client_sources" LIMIT 1`);
    const [klient] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "programAccess", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'POVOLEN', now())
       RETURNING "id"`,
      [jmeno, `konec-${pripona()}@example.test`, zdroj!.id],
    );
    for (const posun of posunyDnu) {
      const produktId = await zalozProdukt(`Členství Konec ${pripona()}`, 12);
      await dotaz(
        `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2,
                 date_trunc('day', now() AT TIME ZONE 'Europe/Prague') AT TIME ZONE 'Europe/Prague'
                   + make_interval(days => $3), now())`,
        [klient!.id, produktId, posun],
      );
    }
  }

  test("prošlé členství s přístupem se zvýrazní, běžící ne", async ({ page }) => {
    const znacka = pripona();
    const skoncil = `Konec Prosle ${znacka}`;
    const bezi = `Konec Bezi ${znacka}`;
    await klientSPlatnostmi(skoncil, [-3]);
    // Jedno skončilo, druhé běží — klient zvýrazněný není.
    await klientSPlatnostmi(bezi, [-3, 30]);

    const radekSkoncil = page.getByRole("row").filter({ hasText: skoncil });
    await otevriAzUvidis(page, `/klienti?hledat=${encodeURIComponent(znacka)}`, radekSkoncil);

    await expect(
      page.getByText(/skončilo členství.*přístup do programu (má|mají) pořád povolený/),
    ).toBeVisible();
    await expect(page.getByText("Vypnout přístup může administrátor.")).toBeVisible();
    await expect(radekSkoncil).toHaveClass(/bg-konec-clenstvi/);
    await expect(page.getByRole("row").filter({ hasText: bezi })).not.toHaveClass(
      /bg-konec-clenstvi/,
    );
    await bezVodorovnehoPosuvu(page);
  });
});
