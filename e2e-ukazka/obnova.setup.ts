import { expect, test } from "@playwright/test";

import { UKAZKOVY_TYM } from "../src/lib/ukazka";
import { dotaz } from "../e2e/pomocne";

/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

/** Stejná hodnota jako `ORDER_API_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_OBJEDNAVEK = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

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

  // Landing Page (krok 1C): objednávka a klient z webu se do rána
  // uklidí, ukázka se nezanáší.
  const email = "landing.obnova@example.test";
  const objednavka = await request.post("/api/objednavky", {
    headers: { "X-API-Key": KLIC_OBJEDNAVEK },
    data: {
      email,
      jmeno: "Návštěvník",
      prijmeni: "Z webu",
      souhlasMarketing: false,
      souhlasPodminky: true,
      nemamBrokera: true,
      produkty: [{ nazev: "BSM - Měsíční členství" }],
    },
  });
  expect(objednavka.status()).toBe(201);
  const klientZWebu = `SELECT c."id" FROM "clients" c JOIN "orders" o ON o."clientId" = c."id"
                        WHERE c."email" = $1`;
  expect(await dotaz(klientZWebu, [email])).toHaveLength(1);

  // „Další ráno“: obnova se pozná podle času nastavení hesla ukázkového účtu.
  await dotaz(`UPDATE "users" SET "passwordSetAt" = now() - interval '2 days' WHERE "email" = $1`, [
    UKAZKOVY_TYM.email,
  ]);
  const rano = await zavolej();
  expect(await rano.json()).toMatchObject({ ok: true, ukazka: true, obnoveno: true });
  expect(await dotaz(`SELECT "id" FROM "clients" WHERE "email" = $1`, [email])).toHaveLength(0);
});
