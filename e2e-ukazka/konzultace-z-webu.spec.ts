import { expect, test, type APIRequestContext } from "@playwright/test";

import { dotaz, nahodnaAdresa } from "../e2e/pomocne";

/**
 * Úvodní konzultace zdarma z Landing Page (6H, Jakub 27. 10. 2026;
 * `src/lib/konzultace-z-webu.ts`).
 *
 * | Kdo                   | Smí                                                  |
 * | --------------------- | ---------------------------------------------------- |
 * | Landing Page s klíčem | vidět volné termíny (id, začátek, délka), rezervovat |
 * | bez klíče             | nic (401)                                            |
 * | mimo ukázku           | nic (404, `e2e/konzultace-z-webu.spec.ts`)           |
 */

/** Stejný klíč jako `ORDER_API_KEY` služby `e2e` v `compose.yaml`. */
const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

type Termin = { id: string; zacatek: string; delkaMinut: number };

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
});

async function terminy(request: APIRequestContext): Promise<Termin[]> {
  const odpoved = await request.get("/api/konzultace/terminy", {
    headers: { "X-API-Key": KLIC, "x-forwarded-for": nahodnaAdresa() },
  });
  expect(odpoved.status()).toBe(200);
  return ((await odpoved.json()) as { terminy: Termin[] }).terminy;
}

function rezervuj(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/konzultace/rezervace", {
    headers: { "X-API-Key": KLIC, "x-forwarded-for": nahodnaAdresa() },
    data,
  });
}

test("bez klíče termíny ani rezervace nejdou", async ({ request }) => {
  expect((await request.get("/api/konzultace/terminy")).status()).toBe(401);
  const rezervace = await request.post("/api/konzultace/rezervace", {
    data: { terminId: "x", jmeno: "Návštěvník", email: "navstevnik@example.test" },
  });
  expect(rezervace.status()).toBe(401);
});

test("termíny nesou jen začátek a délku", async ({ request }) => {
  const seznam = await terminy(request);
  // Noční obnova vypíše tucet termínů, jeden má Eva.
  expect(seznam.length).toBeGreaterThanOrEqual(5);
  for (const termin of seznam) {
    expect(Object.keys(termin).sort()).toEqual(["delkaMinut", "id", "zacatek"]);
    expect(new Date(termin.zacatek).getTime()).toBeGreaterThan(Date.now());
  }
});

test("rezervace založí klienta a zabere termín jen jednou", async ({ page, request }) => {
  const [prvni, druhy] = await terminy(request);
  const email = `uvodni.${Date.now()}@example.test`;

  const odpoved = await rezervuj(request, {
    terminId: prvni!.id,
    jmeno: "Návštěvník",
    prijmeni: "Úvodní konzultace",
    email,
  });
  expect(odpoved.status()).toBe(201);
  const vysledek = (await odpoved.json()) as { klientId: string; termin: Termin };
  expect(vysledek.termin.zacatek).toBe(prvni!.zacatek);

  // Rezervace je úvodní zdarma — ze zaplacených neubírá.
  const radky = await dotaz<{ free: boolean }>(
    `SELECT "free" FROM "consultation_bookings" WHERE "clientId" = $1 AND "cancelledAt" IS NULL`,
    [vysledek.klientId],
  );
  expect(radky).toEqual([{ free: true }]);

  // Termín z nabídky zmizel a podruhé ho nikdo nezabere.
  expect((await terminy(request)).map((t) => t.id)).not.toContain(prvni!.id);
  const obsazeny = await rezervuj(request, {
    terminId: prvni!.id,
    jmeno: "Někdo",
    email: `jiny.${Date.now()}@example.test`,
  });
  expect(obsazeny.status()).toBe(409);

  // Druhá úvodní pro téhož člověka neprojde ani na jiný termín.
  const znovu = await rezervuj(request, { terminId: druhy!.id, jmeno: "Návštěvník", email });
  expect(znovu.status()).toBe(409);
  expect(((await znovu.json()) as { chyba: string }).chyba).toContain("už máte");

  // Člen týmu vidí rezervaci se štítkem v Konzultacích i na kartě.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  await page.goto("/prihlaseni?pokracovat=/konzultace");
  await page.getByRole("button", { name: "Vyzkoušet jako člen týmu" }).click();
  await expect(page).toHaveURL(/\/konzultace/);
  const radek = page
    .getByTestId("termin-konzultace")
    .filter({ hasText: "Návštěvník Úvodní konzultace" });
  await expect(radek.getByText("Úvodní z webu")).toBeVisible();

  await page.goto(`/klienti/${vysledek.klientId}`);
  await expect(page.getByText(/úvodní z webu/)).toBeVisible();
});

test("neúplná rezervace se odmítne", async ({ request }) => {
  const [termin] = await terminy(request);
  const bezJmena = await rezervuj(request, {
    terminId: termin!.id,
    email: `bez.jmena.${Date.now()}@example.test`,
  });
  expect(bezJmena.status()).toBe(400);

  const poleNavic = await rezervuj(request, {
    terminId: termin!.id,
    jmeno: "Návštěvník",
    email: `navic.${Date.now()}@example.test`,
    cena: 0,
  });
  expect(poleNavic.status()).toBe(400);
});
