import { expect, test } from "@playwright/test";

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
 * Slevové kódy (Fáze 5A, Jakub 14. 10. 2026).
 *
 * - **Vidí každý přihlášený, zakládá a mění jen administrátor** — uživatel
 *   kód nezaloží ani přímým voláním akce.
 * - Landing Page posílá jen kód, **slevu počítá CRM**: procenta z ceny
 *   s DPH, částka s DPH rozpočítaná podle ceny produktů.
 * - **Neplatný kód objednávku odmítne** a nevznikne ani klient.
 * - Omezení: platnost od–do, počet použití, jen vybrané produkty,
 *   jednou na klienta.
 * - `POST /api/objednavky/kod` ověří kód předem a nic nezapíše.
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

/**
 * Klíč a vlastní adresa pro každý požadavek — příjem objednávek pouští
 * 30 požadavků za minutu z jedné adresy a testy jdou všechny z jednoho
 * kontejneru (stejně jako u přihlášení, viz `nahodnaAdresa()`).
 */
function hlavicky() {
  return { "X-API-Key": KLIC, "X-Forwarded-For": nahodnaAdresa() };
}

/** Produkty ze seedu: 6 500 Kč a 2 900 Kč bez DPH, obě v základní sazbě 21 %. */
const KURZ = "Kurz Základy investování";
const KONZULTACE = "Konzultace 1:1 (60 min)";

interface KodVTestu {
  kind?: "PROCENTA" | "CASTKA";
  value?: number;
  validFrom?: string | null;
  validTo?: string | null;
  maxUses?: number | null;
  oncePerClient?: boolean;
  /** Názvy produktů, na které kód platí. */
  produkty?: string[];
}

/** Založí kód rovnou v databázi a vrátí ho. */
async function zalozKod(nastaveni: KodVTestu = {}): Promise<string> {
  const kod = `E2E${pripona().toUpperCase()}`;
  const [radek] = await dotaz<{ id: string }>(
    `INSERT INTO "discount_codes"
       ("id", "code", "kind", "value", "validFrom", "validTo", "maxUses", "oncePerClient", "updatedAt")
     VALUES ($1, $2, $3::"DiscountKind", $4, $5::timestamptz, $6::timestamptz, $7, $8, now())
     RETURNING "id"`,
    [
      `e2ekod${pripona()}`,
      kod,
      nastaveni.kind ?? "PROCENTA",
      nastaveni.value ?? 20,
      nastaveni.validFrom ?? null,
      nastaveni.validTo ?? null,
      nastaveni.maxUses ?? null,
      nastaveni.oncePerClient ?? false,
    ],
  );
  for (const nazev of nastaveni.produkty ?? []) {
    await dotaz(
      `INSERT INTO "discount_code_products" ("codeId", "productId")
       SELECT $1, "id" FROM "products" WHERE "name" = $2`,
      [radek!.id, nazev],
    );
  }
  return kod;
}

function objednavka(email: string, produkty: { nazev: string; pocet?: number }[], kod?: string) {
  return {
    email,
    jmeno: "Sleva",
    prijmeni: `Test ${pripona()}`,
    souhlasMarketing: false,
    nemamBrokera: true,
    produkty,
    ...(kod ? { slevovyKod: kod } : {}),
  };
}

test.describe("slevové kódy z Landing Page", () => {
  // Rozhraní, ne obrazovka — stačí jeden prohlížeč (viz objednavky-prijem.spec.ts).
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  test("ověření kódu chce klíč a nic nezapíše", async ({ request }) => {
    const kod = await zalozKod();

    const bez = await request.post("/api/objednavky/kod", {
      data: { slevovyKod: kod, produkty: [{ nazev: KURZ }] },
    });
    expect(bez.status()).toBe(401);

    const odpoved = await request.post("/api/objednavky/kod", {
      headers: hlavicky(),
      data: { slevovyKod: kod.toLowerCase(), produkty: [{ nazev: KURZ }] },
    });
    expect(odpoved.status()).toBe(200);
    const telo = await odpoved.json();
    // 6 500 Kč bez DPH = 7 865 Kč s DPH, −20 % = 6 292 Kč.
    expect(telo).toMatchObject({
      ok: true,
      platny: true,
      kod,
      celkemPredSlevou: 7865,
      sleva: 1573,
      celkem: 6292,
    });

    const [pouzito] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "orders" o
       JOIN "discount_codes" d ON d."id" = o."discountCodeId" WHERE d."code" = $1`,
      [kod],
    );
    expect(pouzito?.pocet).toBe(0);

    const neznamy = await request.post("/api/objednavky/kod", {
      headers: hlavicky(),
      data: { slevovyKod: "NEEXISTUJE-ANI-OMYLEM", produkty: [{ nazev: KURZ }] },
    });
    expect(await neznamy.json()).toMatchObject({
      ok: true,
      platny: false,
      duvod: "Slevový kód neexistuje.",
    });
  });

  test("procentní kód zlevní objednávku a tržby počítají cenu po slevě", async ({
    request,
    browser,
  }) => {
    const kod = await zalozKod({ kind: "PROCENTA", value: 20 });
    const odpoved = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(`sleva.${pripona()}@example.test`, [{ nazev: KURZ }], kod),
    });
    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();
    expect(telo.sleva).toEqual({ kod, celkemPredSlevou: 7865, sleva: 1573, celkem: 6292 });

    const [polozka] = await dotaz<{ netPrice: string; listNetPrice: string }>(
      `SELECT i."netPrice"::text, i."listNetPrice"::text FROM "order_items" i
       WHERE i."orderId" = $1`,
      [telo.objednavkaId],
    );
    // Do tržeb jde cena po slevě bez DPH, ceníková zůstává vedle.
    expect(polozka).toEqual({ netPrice: "5200.00", listNetPrice: "6500.00" });

    // Tým uvidí kód u objednávky i na stránce kódů.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const stranka = await tym.newPage();
    await stranka.goto(`/objednavky?hledat=${telo.cislo}`);
    await expect(stranka.getByText(`${kod} −`)).toBeVisible();
    await stranka.goto("/produkty/slevove-kody");
    await expect(stranka.getByRole("cell", { name: kod })).toBeVisible();
    await tym.close();
  });

  test("částka s DPH se rozpočítá na dva produkty a sečte se přesně", async ({ request }) => {
    const kod = await zalozKod({ kind: "CASTKA", value: 500 });
    const odpoved = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(
        `castka.${pripona()}@example.test`,
        [{ nazev: KURZ }, { nazev: KONZULTACE }],
        kod,
      ),
    });
    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();
    // 7 865 + 3 509 = 11 374 Kč s DPH, −500 Kč.
    expect(telo.sleva).toEqual({ kod, celkemPredSlevou: 11374, sleva: 500, celkem: 10874 });
  });

  test("kód na vybraný produkt zlevní jen ten a jinou objednávku odmítne", async ({ request }) => {
    const kod = await zalozKod({ kind: "PROCENTA", value: 10, produkty: [KONZULTACE] });

    const smisena = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(
        `vybrany.${pripona()}@example.test`,
        [{ nazev: KURZ }, { nazev: KONZULTACE }],
        kod,
      ),
    });
    expect(smisena.status()).toBe(201);
    // Jen konzultace: 3 509 Kč s DPH, −10 % = −350,90 Kč.
    expect((await smisena.json()).sleva.sleva).toBe(350.9);

    const email = `jiny.${pripona()}@example.test`;
    const jen = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, [{ nazev: KURZ }], kod),
    });
    expect(jen.status()).toBe(400);
    expect((await jen.json()).chyba).toBe("Slevový kód se nevztahuje na objednané produkty.");

    // Odmítnutá objednávka nenechá v CRM ani klienta.
    const [klient] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "clients" WHERE "email" = $1`,
      [email],
    );
    expect(klient?.pocet).toBe(0);
  });

  test("neplatný kód objednávku odmítne s důvodem", async ({ request }) => {
    const dnes = new Date();
    const den = (posun: number) =>
      new Date(dnes.getTime() + posun * 86_400_000).toISOString().slice(0, 10);

    const pripady: [KodVTestu | null, string][] = [
      [null, "Slevový kód neexistuje."],
      [{ validTo: `${den(-2)}T00:00:00+02:00` }, "Platnost slevového kódu skončila."],
      [{ validFrom: `${den(3)}T00:00:00+02:00` }, "Slevový kód platí až od"],
    ];

    for (const [nastaveni, duvod] of pripady) {
      const kod = nastaveni ? await zalozKod(nastaveni) : "NIKDY-NEBYL";
      const odpoved = await request.post("/api/objednavky", {
        headers: hlavicky(),
        data: objednavka(`neplatny.${pripona()}@example.test`, [{ nazev: KURZ }], kod),
      });
      expect(odpoved.status(), duvod).toBe(400);
      expect((await odpoved.json()).chyba).toContain(duvod);
    }
  });

  test("počet použití a jednou na klienta", async ({ request }) => {
    const vycerpany = await zalozKod({ maxUses: 1 });
    const prvni = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(`max1.${pripona()}@example.test`, [{ nazev: KURZ }], vycerpany),
    });
    expect(prvni.status()).toBe(201);
    const druha = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(`max2.${pripona()}@example.test`, [{ nazev: KURZ }], vycerpany),
    });
    expect(druha.status()).toBe(400);
    expect((await druha.json()).chyba).toBe("Slevový kód je už vyčerpaný.");

    const jednou = await zalozKod({ oncePerClient: true });
    const email = `jednou.${pripona()}@example.test`;
    const poprve = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, [{ nazev: KURZ }], jednou),
    });
    expect(poprve.status()).toBe(201);

    // Stejný e-mail jinými písmeny — pořád tentýž klient.
    const overeni = await request.post("/api/objednavky/kod", {
      headers: hlavicky(),
      data: { slevovyKod: jednou, produkty: [{ nazev: KURZ }], email: email.toUpperCase() },
    });
    expect(await overeni.json()).toMatchObject({
      platny: false,
      duvod: "Tento slevový kód už zákazník použil.",
    });
    const podruhe = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(email, [{ nazev: KURZ }], jednou),
    });
    expect(podruhe.status()).toBe(400);

    // Jiný klient ho použít může.
    const jiny = await request.post("/api/objednavky", {
      headers: hlavicky(),
      data: objednavka(`jednou-jiny.${pripona()}@example.test`, [{ nazev: KURZ }], jednou),
    });
    expect(jiny.status()).toBe(201);
  });
});

test.describe("obrazovka Slevové kódy", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "administrátor kód založí, upraví, smaže a vrátí ze Smazaných",
    { tag: "@telefon" },
    async ({ page, browser }) => {
      const kod = `TEST${pripona().toUpperCase()}`;
      await page.goto("/produkty/slevove-kody");
      await page.getByRole("button", { name: "Nový kód" }).click();
      const okno = page.getByRole("dialog", { name: "Nový slevový kód" });
      await okno.getByLabel("Kód").fill(kod.toLowerCase());
      await okno.getByRole("radio", { name: "V korunách s DPH" }).check();
      await okno.getByLabel("Sleva v Kč s DPH").fill("300");
      await okno.getByLabel("Nejvýš kolikrát").fill("5");
      await okno.getByRole("checkbox", { name: KURZ }).check();
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Uložit" }).click(),
      ]);
      await cekejNaUspech(page, `Kód je založený: ${kod}.`);
      const radek = page.getByRole("row").filter({ hasText: kod });
      await expect(radek.getByText("−300 Kč")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Stejný kód podruhé neprojde, ani malými písmeny.
      await page.getByRole("button", { name: "Nový kód" }).click();
      const druhe = page.getByRole("dialog", { name: "Nový slevový kód" });
      await druhe.getByLabel("Kód").fill(kod.toLowerCase());
      await druhe.getByLabel("Sleva v %").fill("10");
      await druhe.getByRole("button", { name: "Uložit" }).click();
      await expect(druhe.getByText(`Kód ${kod} už existuje.`)).toBeVisible();
      await druhe.getByRole("button", { name: "Zrušit" }).click();

      // Procenta nad 100 neprojdou.
      await page.getByRole("button", { name: `Upravit slevový kód: ${kod}` }).click();
      const uprava = page.getByRole("dialog", { name: "Upravit slevový kód" });
      await uprava.getByRole("radio", { name: "V procentech" }).check();
      await uprava.getByLabel("Sleva v %").fill("120");
      await uprava.getByRole("button", { name: "Uložit" }).click();
      await expect(uprava.getByText("Sleva v procentech může být nejvýš 100 %.")).toBeVisible();
      await uprava.getByLabel("Sleva v %").fill("15");
      await uprava.getByRole("button", { name: "Uložit" }).click();
      await cekejNaUspech(page, `Kód je uložený: ${kod}.`);
      await expect(radek.getByText("−15 %")).toBeVisible();

      // Uživatel vidí seznam, ale tlačítka nemá a akci přímo nezavolá.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const stranka = await tym.newPage();
      await stranka.goto("/produkty/slevove-kody");
      await expect(stranka.getByRole("cell", { name: kod })).toBeVisible();
      await expect(stranka.getByRole("button", { name: "Nový kód" })).toHaveCount(0);
      const podvrh = `PODVRH${pripona().toUpperCase()}`;
      await tym.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        data: (akce.postData() ?? "").replace(kod.toLowerCase(), podvrh),
      });
      const [podvrzeny] = await dotaz<{ pocet: number }>(
        `SELECT count(*)::int AS "pocet" FROM "discount_codes" WHERE "code" = $1`,
        [podvrh],
      );
      expect(podvrzeny?.pocet, "uživatel nesmí kód založit").toBe(0);
      await tym.close();

      await page.getByRole("button", { name: `Smazat slevový kód: ${kod}` }).click();
      const potvrzeni = page.getByRole("dialog", { name: "Smazat slevový kód" });
      await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await potvrzeni.getByRole("button", { name: "Smazat" }).click();
      await cekejNaUspech(page, `Smazáno: ${kod}.`);

      const vKosi = page.getByRole("row").filter({ hasText: kod });
      await otevriAzUvidis(page, "/smazane", vKosi);
      await vKosi.getByRole("button", { name: /Obnovit/ }).click();
      await cekejNaUspech(page, `Slevový kód ${kod} zase platí.`);
    },
  );
});
