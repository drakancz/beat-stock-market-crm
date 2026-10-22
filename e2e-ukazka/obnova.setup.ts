import { expect, test } from "@playwright/test";

/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

test("noční obnova naplní ukázku a týž den podruhé nic nemaže", async ({ request }) => {
  const zavolej = () =>
    request.post("/api/planovac", { headers: { Authorization: `Bearer ${KLIC_PLANOVACE}` } });

  const prvni = await zavolej();
  expect(prvni.status()).toBe(200);
  expect(await prvni.json()).toMatchObject({ ok: true, ukazka: true, obnoveno: true });

  // Plánovač může běžet častěji (webináře) — obnova uprostřed dne by
  // návštěvníkovi smazala rozdělanou práci.
  const druhy = await zavolej();
  expect(await druhy.json()).toMatchObject({ ok: true, ukazka: true, obnoveno: false });
});
