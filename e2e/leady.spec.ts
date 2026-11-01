import { expect, test } from "@playwright/test";

import { dotaz, pripona } from "./pomocne";

/**
 * Příjem klientů z webu — `POST /api/leady` (docs/funkce/leady.md).
 *
 * Landing Page sem posílá formulář „Ukázková lekce zdarma“ (krok 6A,
 * Jakub 27. 10. 2026) s údajem `zajem`, podle kterého tým v poznámce
 * pozná, proč klient přišel.
 *
 * **Klíč je v `compose.yaml` u služby `e2e`** a je jen pro testy — heslo,
 * kterým se volající prokazuje nám, nic nikam neodchází.
 */

const KLIC = "e2e-leady-klic-nepouzivat-nikde-jinde-00001";

async function poznamky(email: string): Promise<string[]> {
  const radky = await dotaz<{ text: string }>(
    `SELECT n."text" FROM "client_notes" n JOIN "clients" c ON c."id" = n."clientId"
      WHERE c."email" = $1 ORDER BY n."createdAt"`,
    [email],
  );
  return radky.map((radek) => radek.text);
}

test.describe("příjem klientů z webu", () => {
  // Volání rozhraní, ne obrazovka — stačí jeden prohlížeč (jako příjem objednávek).
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  test("špatný klíč se nepřijme", async ({ request }) => {
    const odpoved = await request.post("/api/leady", {
      headers: { "X-API-Key": "tohle-rozhodne-neni-spravny-klic-ani-nahodou" },
      data: { email: "nekdo@example.test" },
    });
    expect(odpoved.status()).toBe(401);
  });

  test("ukázková lekce založí klienta s poznámkou, duplicita druhého ne", async ({ request }) => {
    const znacka = pripona();
    const email = `lekce.${znacka}@example.test`;
    const telo = { email, jmeno: `Lekce ${znacka}`, souhlasMarketing: false, zajem: "ukazkova-lekce" };

    const prvni = await request.post("/api/leady", { headers: { "X-API-Key": KLIC }, data: telo });
    expect(prvni.status()).toBe(201);
    const vysledek = await prvni.json();
    expect(vysledek.stav).toBe("zalozen");
    expect(vysledek.klientId).toBeTruthy();

    expect((await poznamky(email))[0]).toContain("Chce ukázkovou lekci zdarma.");

    // Podruhé (třeba znovu odeslaný formulář) — stejný klient, jen další poznámka.
    const druhy = await request.post("/api/leady", { headers: { "X-API-Key": KLIC }, data: telo });
    expect(druhy.status()).toBe(200);
    const opakovany = await druhy.json();
    expect(opakovany.stav).toBe("duplicita");
    expect(opakovany.klientId).toBe(vysledek.klientId);

    const [pocet] = await dotaz<{ pocet: number }>(
      `SELECT COUNT(*)::int AS "pocet" FROM "clients" WHERE "email" = $1`,
      [email],
    );
    expect(pocet?.pocet).toBe(1);
    const vsechny = await poznamky(email);
    expect(vsechny).toHaveLength(2);
    expect(vsechny[1]).toContain("Chce ukázkovou lekci zdarma.");
  });

  test("neznámý zájem se odmítne", async ({ request }) => {
    const odpoved = await request.post("/api/leady", {
      headers: { "X-API-Key": KLIC },
      data: { email: `zajem.${pripona()}@example.test`, zajem: "cokoli z webu" },
    });
    expect(odpoved.status()).toBe(400);
  });
});
