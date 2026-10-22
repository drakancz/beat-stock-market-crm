import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  cekejNaZmizeniUpozorneni,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
  vyber,
} from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Doporučení a odměny (Fáze 5A, 2. část, Jakub 15. 10. 2026).
 *
 * - Doporučitel má vlastní slevový kód. **Nový klient**, který s ním poprvé
 *   objedná, je jeho přivedený; klient, který už objednal, ne.
 * - **Sám sebe doporučit nejde.**
 * - **Odměna = procento z první zaplacené objednávky** po slevě bez DPH.
 *   Návrat ze Zaplaceno nevyplacenou odměnu zruší, vyplacenou ne.
 * - **Doporučitele a odměny vidí a mění jen administrátor** — uživatel
 *   dostane 404 a akci nezavolá ani napřímo. „Přivedl: …“ vidí každý.
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

function hlavicky() {
  return { "X-API-Key": KLIC, "X-Forwarded-For": nahodnaAdresa() };
}

/** Ze seedu: 6 500 Kč bez DPH, 21 %. */
const KURZ = "Kurz Základy investování";

/** Založí doporučitele a jeho kód (−20 %) rovnou v databázi. */
async function zalozDoporucitele(
  nastaveni: { procento?: number; klientId?: string } = {},
): Promise<{ id: string; jmeno: string; kod: string }> {
  const jmeno = `Partner ${pripona()}`;
  const [doporucitel] = await dotaz<{ id: string }>(
    `INSERT INTO "referrers" ("id", "kind", "name", "clientId", "rewardPercent", "updatedAt")
     VALUES ($1, $2::"ReferrerKind", $3, $4, $5, now()) RETURNING "id"`,
    [
      `e2edop${pripona()}`,
      nastaveni.klientId ? "KLIENT" : "PARTNER",
      jmeno,
      nastaveni.klientId ?? null,
      nastaveni.procento ?? 10,
    ],
  );
  const kod = `DOP${pripona().toUpperCase()}`;
  await dotaz(
    `INSERT INTO "discount_codes" ("id", "code", "kind", "value", "referrerId", "updatedAt")
     VALUES ($1, $2, 'PROCENTA', 20, $3, now())`,
    [`e2ekod${pripona()}`, kod, doporucitel!.id],
  );
  return { id: doporucitel!.id, jmeno, kod };
}

function objednavka(email: string, kod?: string, stav?: "NOVA" | "ZAPLACENO") {
  return {
    email,
    jmeno: "Doporuceny",
    prijmeni: `Test ${pripona()}`,
    souhlasMarketing: false,
    nemamBrokera: true,
    produkty: [{ nazev: KURZ }],
    ...(kod ? { slevovyKod: kod } : {}),
    ...(stav ? { stav } : {}),
  };
}

async function odmenaObjednavky(objednavkaId: string) {
  const [odmena] = await dotaz<{ amount: string; base: string; paidOutAt: Date | null }>(
    `SELECT "amount"::text, "base"::text, "paidOutAt" FROM "referral_rewards" WHERE "orderId" = $1`,
    [objednavkaId],
  );
  return odmena ?? null;
}

async function privedl(klientId: string) {
  const [klient] = await dotaz<{ referredById: string | null }>(
    `SELECT "referredById" FROM "clients" WHERE "id" = $1`,
    [klientId],
  );
  return klient?.referredById ?? null;
}

test.describe("doporučení z Landing Page", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  test("nový klient je přivedený a zaplacením vznikne odměna", async ({ request }) => {
    const doporucitel = await zalozDoporucitele({ procento: 10 });
    const email = `novy.${pripona()}@example.test`;
    const odpoved = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, doporucitel.kod, "ZAPLACENO"),
    });
    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();

    expect(await privedl(telo.klientId)).toBe(doporucitel.id);
    // 6 500 Kč −20 % = 5 200 Kč bez DPH, 10 % = 520 Kč.
    expect(await odmenaObjednavky(telo.objednavkaId)).toEqual({
      amount: "520.00",
      base: "5200.00",
      paidOutAt: null,
    });

    // Další objednávka téhož klienta už odměnu nepřinese.
    const znovu = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, doporucitel.kod, "ZAPLACENO"),
    });
    expect(znovu.status()).toBe(201);
    expect(await odmenaObjednavky((await znovu.json()).objednavkaId)).toBeNull();
  });

  test("klient, který už objednal, nikoho nepřivedl", async ({ request }) => {
    const doporucitel = await zalozDoporucitele();
    const email = `stavajici.${pripona()}@example.test`;
    const prvni = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email),
    });
    expect(prvni.status()).toBe(201);

    const sKodem = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, doporucitel.kod, "ZAPLACENO"),
    });
    expect(sKodem.status()).toBe(201);
    const telo = await sKodem.json();
    // Slevu dostal, doporučení ani odměna nevznikly.
    expect(telo.sleva.sleva).toBe(1573);
    expect(await privedl(telo.klientId)).toBeNull();
    expect(await odmenaObjednavky(telo.objednavkaId)).toBeNull();
  });

  test("sám sebe doporučit nejde", async ({ request }) => {
    const email = `sam.${pripona()}@example.test`;
    // Klient bez objednávky, který dostane vlastní kód.
    const [klient] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'landing-page', now())
       RETURNING "id"`,
      [`Sam Sebe ${pripona()}`, email],
    );
    const doporucitel = await zalozDoporucitele({ klientId: klient!.id });

    const odpoved = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, doporucitel.kod, "ZAPLACENO"),
    });
    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();
    expect(await privedl(telo.klientId)).toBeNull();
    expect(await odmenaObjednavky(telo.objednavkaId)).toBeNull();
  });
});

test.describe("obrazovka Doporučitelé", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "administrátor založí partnera, přiřadí kód a odškrtne vyplacení",
    { tag: "@telefon" },
    async ({ page, browser, request }) => {
      const jmeno = `Partner UI ${pripona()}`;
      await page.goto("/produkty/doporucitele");
      await page.getByRole("button", { name: "Nový doporučitel" }).click();
      const okno = page.getByRole("dialog", { name: "Nový doporučitel" });
      await okno.getByRole("radio", { name: "Partner zvenku" }).check();
      await okno.getByLabel("Jméno partnera").fill(jmeno);
      await okno.getByLabel("Odměna v %").fill("12,5");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await cekejNaUspech(page, `Doporučitel je založený: ${jmeno}.`);
      const radek = page.getByRole("row").filter({ hasText: jmeno });
      await expect(radek.getByText("12,5 %")).toBeVisible();
      await expect(radek.getByText("bez kódu")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Kód mu přiřadí okno slevového kódu.
      const kod = `UI${pripona().toUpperCase()}`;
      await page.goto("/produkty/slevove-kody");
      await page.getByRole("button", { name: "Nový kód" }).click();
      const kodOkno = page.getByRole("dialog", { name: "Nový slevový kód" });
      await kodOkno.getByLabel("Kód").fill(kod);
      await kodOkno.getByLabel("Sleva v %").fill("20");
      await kodOkno.getByLabel("Patří doporučiteli").click();
      await page.getByRole("option", { name: jmeno }).click();
      await kodOkno.getByRole("button", { name: "Uložit" }).click();
      await cekejNaUspech(page, `Kód je založený: ${kod}.`);
      await expect(
        page.getByRole("row").filter({ hasText: kod }).getByText(`Doporučitel: ${jmeno}`),
      ).toBeVisible();

      // Nový klient objedná s kódem, administrátor objednávku označí jako zaplacenou.
      const odpoved = await request.post("/api/objednavky", {
        headers: hlavicky(),
        data: objednavka(`ui.${pripona()}@example.test`, kod),
      });
      expect(odpoved.status()).toBe(201);
      const telo = await odpoved.json();
      const radekObjednavky = page.getByRole("row").filter({ hasText: telo.cislo });
      await otevriAzUvidis(page, `/objednavky?hledat=${telo.cislo}`, radekObjednavky);
      await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
      await cekejNaUspech(page, /Stav objednávky je změněný/);
      // 5 200 Kč × 12,5 % = 650 Kč.
      await expect
        .poll(async () => (await odmenaObjednavky(telo.objednavkaId))?.amount)
        .toBe("650.00");

      // Návrat ze Zaplaceno nevyplacenou odměnu zruší, nové zaplacení ji vrátí.
      await cekejNaZmizeniUpozorneni(page);
      await vyber(page, "Změnit stav objednávky", /^Nezaplaceno$/);
      await cekejNaUspech(page, /Stav objednávky je změněný/);
      await expect.poll(() => odmenaObjednavky(telo.objednavkaId)).toBeNull();
      await cekejNaZmizeniUpozorneni(page);
      await vyber(page, "Změnit stav objednávky", /^Zaplaceno$/);
      await cekejNaUspech(page, /Stav objednávky je změněný/);
      await expect.poll(() => odmenaObjednavky(telo.objednavkaId)).not.toBeNull();

      // Odškrtnutí vyplacení.
      const odmena = page.getByRole("row").filter({ hasText: telo.cislo });
      await otevriAzUvidis(page, "/produkty/doporucitele", odmena);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        odmena.getByRole("button", { name: /^Vyplaceno/ }).click(),
      ]);
      await cekejNaUspech(page, `Vyplaceno: ${jmeno}, objednávka ${telo.cislo}.`);
      await expect(odmena.getByText(/^Vyplaceno \d/)).toBeVisible();

      // Vyplacená odměna zůstane i po návratu ze Zaplaceno.
      await otevriAzUvidis(page, `/objednavky?hledat=${telo.cislo}`, radekObjednavky);
      await vyber(page, "Změnit stav objednávky", /^Nezaplaceno$/);
      await cekejNaUspech(page, /odměna doporučiteli z ní je už vyplacená/i);
      await expect
        .poll(async () => (await odmenaObjednavky(telo.objednavkaId))?.paidOutAt)
        .not.toBeNull();

      // Uživatel: na kartě vidí „Přivedl“, ale ne odměnu; obrazovka je pro něj 404
      // a akci nezavolá ani napřímo.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const stranka = await tym.newPage();
      await stranka.goto(`/klienti/${telo.klientId}`);
      await expect(stranka.getByText("Přivedl")).toBeVisible();
      await expect(stranka.getByText(jmeno)).toBeVisible();
      await expect(stranka.getByText(/Odměna \d/)).toHaveCount(0);
      await stranka.goto("/produkty");
      await expect(stranka.getByRole("link", { name: "Doporučitelé" })).toHaveCount(0);
      const zakazana = await stranka.goto("/produkty/doporucitele");
      expect(zakazana?.status()).toBe(404);

      await tym.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        // Akce s argumenty (id, true) — uživatel by chtěl odškrtnutí vrátit.
        data: (akce.postData() ?? "").replace("true", "false"),
      });
      expect(
        (await odmenaObjednavky(telo.objednavkaId))?.paidOutAt,
        "uživatel nesmí měnit vyplacení",
      ).not.toBeNull();
      await tym.close();

      // Admin vidí na kartě i odměnu.
      await page.goto(`/klienti/${telo.klientId}`);
      await expect(page.getByText(/Odměna 650,00 Kč · vyplaceno/)).toBeVisible();
    },
  );

  test("doporučitele s kódem smazat nejde, bez kódu jde do koše a zpět", async ({ page }) => {
    const doporucitel = await zalozDoporucitele();
    await page.goto("/produkty/doporucitele");
    await page.getByRole("button", { name: `Smazat doporučitele: ${doporucitel.jmeno}` }).click();
    let potvrzeni = page.getByRole("dialog", { name: "Smazat doporučitele" });
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await expect(page.getByText(`má slevový kód ${doporucitel.kod}`)).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Zrušit" }).click();

    await dotaz(`UPDATE "discount_codes" SET "deletedAt" = now() WHERE "code" = $1`, [
      doporucitel.kod,
    ]);
    await page.reload();
    await page.getByRole("button", { name: `Smazat doporučitele: ${doporucitel.jmeno}` }).click();
    potvrzeni = page.getByRole("dialog", { name: "Smazat doporučitele" });
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: ${doporucitel.jmeno}.`);

    const vKosi = page.getByRole("row").filter({ hasText: doporucitel.jmeno });
    await otevriAzUvidis(page, "/smazane", vKosi);
    await vKosi.getByRole("button", { name: /Obnovit/ }).click();
    await cekejNaUspech(page, `${doporucitel.jmeno} je zpátky mezi doporučiteli.`);
  });
});

test.describe("Doporuč přítele v klientské části", () => {
  test(
    "doporučitel vidí kód, počet přivedených a odměny bez jmen; jiný klient nic",
    { tag: "@telefon" },
    async ({ browser }) => {
      const doporucujici = await zalozKlientaSUctem(`Doporučující ${pripona()}`);
      const doporucitel = await zalozDoporucitele({ klientId: doporucujici.id, procento: 15 });
      const privedeny = await zalozKlientaSUctem(`Přivedený ${pripona()}`);
      await dotaz(`UPDATE "clients" SET "referredById" = $1 WHERE "id" = $2`, [
        doporucitel.id,
        privedeny.id,
      ]);
      const objednavkaId = await zaplatProdukt(
        privedeny.id,
        await zalozProdukt(`E2E Kurz doporuč ${pripona()}`),
      );
      await dotaz(
        `INSERT INTO "referral_rewards" ("id", "referrerId", "orderId", "percent", "base", "amount",
                                       "currency")
       VALUES ($1, $2, $3, 15, 1000, 150, 'CZK')`,
        [`e2eodm${pripona()}`, doporucitel.id, objednavkaId],
      );
      const jiny = await zalozKlientaSUctem(`Nedoporučující ${pripona()}`);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, doporucujici.email, doporucujici.heslo);
      await page.getByRole("link", { name: "Kód a odměny" }).click();
      await expect(page.getByRole("heading", { name: "Doporuč přítele", level: 1 })).toBeVisible();
      await expect(page.getByTestId("kod-doporucitele")).toContainText(doporucitel.kod);
      await expect(page.getByTestId("kod-doporucitele")).toContainText("−20 % pro kamaráda");
      await expect(page.getByText("15 % z jeho první zaplacené objednávky")).toBeVisible();
      await expect(page.getByTestId("privedeno")).toHaveText("1 nového klienta");
      await expect(page.getByTestId("ceka-na-vyplatu")).toContainText("150");
      // Jméno přivedeného klienta se doporučiteli neukazuje.
      expect(await page.content()).not.toContain(privedeny.name);
      await bezVodorovnehoPosuvu(page);
      await page.context().close();

      const druha = await prohlizecKlienta(browser);
      await prihlasKlienta(druha, jiny.email, jiny.heslo);
      await expect(druha.getByRole("link", { name: "Kód a odměny" })).toHaveCount(0);
      const odpoved = await druha.goto("/ucet/doporuc");
      expect(odpoved?.status()).toBe(404);
      await druha.context().close();
    },
  );
});
