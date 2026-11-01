import { expect, test, type APIRequestContext } from "@playwright/test";

import { dotaz, pripona } from "./pomocne";
import { zalozProdukt } from "./pomocne-klient";

/**
 * Landing Page — ceník a údaje k platbě (kroky 1A a 1B, Jakub 25.–26. 10. 2026).
 *
 * | Kdo                         | Smí                                          |
 * | --------------------------- | -------------------------------------------- |
 * | Landing Page s klíčem       | načíst ceník, po objednání dostat údaje k převodu |
 * | kdokoli bez klíče           | nic (401)                                    |
 * | přes tyhle adresy nikdo     | nic měnit                                    |
 *
 * Klíč je testovací ze `compose.yaml` (služba `e2e`), nic neodchází ven.
 * Číslo účtu firmy je stejné jako v `koupit.spec.ts`, ať se souběžné
 * testy nepřepisují.
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";
const UCET = "19-2000145399/0800";
const IBAN = "CZ6508000000192000145399";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
});

type Produkt = {
  id: string;
  nazev: string;
  druh: string;
  cenaBezDph: number;
  sazbaDph: number;
  cenaSDph: number;
  mena: string;
  platnostMesicu: number | null;
  odkaz: string | null;
};

async function cenik(request: APIRequestContext): Promise<Produkt[]> {
  const odpoved = await request.get("/api/objednavky/cenik", { headers: { "X-API-Key": KLIC } });
  expect(odpoved.status()).toBe(200);
  const telo = await odpoved.json();
  expect(telo.ok).toBe(true);
  return telo.produkty;
}

test.describe("ceník pro Landing Page", () => {
  test("bez klíče a se špatným klíčem se nevrátí nic", async ({ request }) => {
    expect((await request.get("/api/objednavky/cenik")).status()).toBe(401);
    const spatny = await request.get("/api/objednavky/cenik", {
      headers: { Authorization: "Bearer tohle-rozhodne-neni-spravny-klic-ani-nahodou" },
    });
    expect(spatny.status()).toBe(401);
  });

  test("ceny sedí s ceníkem, s DPH i bez", async ({ request }) => {
    const nazev = `E2E Členství ceník ${pripona()}`;
    const id = await zalozProdukt(nazev, "CLENSTVI", "https://example.test/clenstvi");

    const produkt = (await cenik(request)).find((p) => p.id === id);
    expect(produkt).toEqual({
      id,
      nazev,
      druh: "CLENSTVI",
      cenaBezDph: 1000,
      sazbaDph: 21,
      cenaSDph: 1210,
      mena: "CZK",
      platnostMesicu: 12,
      odkaz: "https://example.test/clenstvi",
    });
  });

  test("neprodávaný a smazaný produkt v nabídce chybí", async ({ request }) => {
    const neprodavany = await zalozProdukt(`E2E Neprodávaný ${pripona()}`);
    const smazany = await zalozProdukt(`E2E Smazaný ${pripona()}`);
    await dotaz(`UPDATE "products" SET "active" = false WHERE "id" = $1`, [neprodavany]);
    await dotaz(`UPDATE "products" SET "deletedAt" = now() WHERE "id" = $1`, [smazany]);

    const ids = (await cenik(request)).map((p) => p.id);
    expect(ids).not.toContain(neprodavany);
    expect(ids).not.toContain(smazany);
  });

  test("v odpovědi nejsou žádné údaje o klientech", async ({ request }) => {
    const odpoved = await request.get("/api/objednavky/cenik", { headers: { "X-API-Key": KLIC } });
    const text = await odpoved.text();
    // Žádný e-mail ani pole, které by patřilo klientovi nebo objednávce.
    expect(text).not.toContain("@");
    for (const produkt of (JSON.parse(text) as { produkty: Produkt[] }).produkty) {
      expect(Object.keys(produkt).sort()).toEqual(
        [
          "cenaBezDph",
          "cenaSDph",
          "druh",
          "id",
          "mena",
          "nazev",
          "odkaz",
          "platnostMesicu",
          "sazbaDph",
        ].sort(),
      );
    }
  });
});

test.describe("údaje k platbě po objednání", () => {
  test.beforeEach(async () => {
    await dotaz(
      `INSERT INTO "company_settings" ("id", "bankAccount", "updatedAt") VALUES ('firma', $1, now())
       ON CONFLICT ("id") DO UPDATE SET "bankAccount" = $1`,
      [UCET],
    );
  });

  const objednej = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email: `platba.${pripona()}@example.test`,
        souhlasMarketing: false,
        nemamBrokera: true,
        ...data,
      },
    });

  test("nezaplacená objednávka vrátí částku, účet, VS a QR platbu", async ({ request }) => {
    const id = await zalozProdukt(`E2E Kurz platba ${pripona()}`);

    const odpoved = await objednej(request, { produkty: [{ id, pocet: 2 }] });
    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();

    const vs = telo.cislo.replace(/\D/g, "");
    // Příjemce je název firmy z Nastavení — v testech může být prázdný.
    expect(telo.platba).toMatchObject({
      castka: 2420,
      mena: "CZK",
      cisloUctu: UCET,
      iban: IBAN,
      variabilniSymbol: vs,
      qrPlatba: `SPD*1.0*ACC:${IBAN}*AM:2420.00*CC:CZK*X-VS:${vs}*MSG:Objednavka ${telo.cislo}`,
    });
  });

  test("se slevovým kódem je částka po slevě", async ({ request }) => {
    const id = await zalozProdukt(`E2E Kurz sleva platba ${pripona()}`);
    const kod = `E2EPLATBA${pripona().toUpperCase()}`;
    await dotaz(
      `INSERT INTO "discount_codes" ("id", "code", "kind", "value", "updatedAt")
       VALUES ($1, $2, 'PROCENTA', 20, now())`,
      [`e2eplatba${pripona()}`, kod],
    );

    const telo = await (await objednej(request, { produkty: [{ id }], slevovyKod: kod })).json();
    expect(telo.sleva.celkem).toBe(968);
    expect(telo.platba.castka).toBe(968);
    expect(telo.platba.qrPlatba).toContain("*AM:968.00*");
  });

  test("souhlas s obchodními podmínkami se zapíše k objednávce", async ({ request }) => {
    const id = await zalozProdukt(`E2E Kurz podmínky ${pripona()}`);

    const s = await (await objednej(request, { produkty: [{ id }], souhlasPodminky: true })).json();
    const bez = await (await objednej(request, { produkty: [{ id }] })).json();
    const [se, bezSouhlasu] = await Promise.all(
      [s.cislo, bez.cislo].map(async (cislo) => {
        const [radek] = await dotaz<{ termsVersion: string | null; termsAcceptedAt: Date | null }>(
          `SELECT "termsVersion", "termsAcceptedAt" FROM "orders" WHERE "number" = $1`,
          [cislo],
        );
        return radek;
      }),
    );
    // Znění podmínek = `OBCHODNI_PODMINKY_OD` („20. 10. 2026“).
    expect(se?.termsVersion).toMatch(/^\d{1,2}\. \d{1,2}\. \d{4}$/);
    expect(se?.termsAcceptedAt).not.toBeNull();
    expect(bezSouhlasu?.termsVersion).toBeNull();

    // „Nesouhlasím“ se nepřijímá — web bez souhlasu objednávku neposílá.
    const nesouhlas = await objednej(request, { produkty: [{ id }], souhlasPodminky: false });
    expect(nesouhlas.status()).toBe(400);
  });

  test("zaplacená objednávka údaje k platbě nevrátí", async ({ request }) => {
    const id = await zalozProdukt(`E2E Kurz zaplaceno ${pripona()}`);
    const telo = await (await objednej(request, { produkty: [{ id }], stav: "ZAPLACENO" })).json();
    expect(telo.ok).toBe(true);
    expect(telo.platba).toBeUndefined();
  });
});
