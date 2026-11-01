import { expect, test } from "@playwright/test";

/**
 * Úvodní konzultace zdarma z Landing Page (6H, Jakub 27. 10. 2026) —
 * **mimo ukázkový režim adresy neexistují**, ani se správným klíčem.
 * Průchod v ukázce je v `e2e-ukazka/konzultace-z-webu.spec.ts`.
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
});

test("bez ukázkového režimu vrací termíny i rezervace 404", async ({ request }) => {
  const terminy = await request.get("/api/konzultace/terminy", { headers: { "X-API-Key": KLIC } });
  expect(terminy.status()).toBe(404);

  const rezervace = await request.post("/api/konzultace/rezervace", {
    headers: { "X-API-Key": KLIC },
    data: { terminId: "cokoli", jmeno: "Návštěvník", email: "navstevnik@example.test" },
  });
  expect(rezervace.status()).toBe(404);
});
