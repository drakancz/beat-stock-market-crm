import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  jeMobil,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";

/**
 * Možné duplicity a konverzní trychtýř (Jakub, 27. 9. 2026, krok 2B).
 *
 * - Návrhy (stejný telefon, stejné jméno) vidí každý přihlášený a každý
 *   smí potvrdit „Nejsou stejný člověk“.
 * - **Sloučit smí jen administrátor.** Přesune objednávky a další historii,
 *   souhlas s marketingem platí novější, přístup do programu povolený,
 *   když ho měla aspoň jedna karta. Sloučená karta jde do Smazaných.
 * - Trychtýř na Dashboardu: noví klienti → objednali → zaplatili.
 *
 * Klienti se zapisují přímo SQL s náhodnou příponou a náhodným telefonem —
 * testy běží souběžně ve třech prohlížečích.
 */

/** Náhodný český mobil v jednotném tvaru `+420 6xx xxx xxx`. */
function nahodnyTelefon(): string {
  const cislice = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  return `+420 6${cislice.slice(0, 2)} ${cislice.slice(2, 5)} ${cislice.slice(5)}`;
}

async function zdroj(): Promise<string> {
  const [radek] = await dotaz<{ id: string }>(`SELECT "id" FROM "client_sources" LIMIT 1`);
  return radek!.id;
}

interface NovyKlient {
  jmeno: string;
  telefon?: string | null;
  sourceId?: string;
  souhlas?: Date | null;
  odhlaseni?: Date | null;
  pristup?: "POVOLEN" | "NEPOVOLEN";
  vytvoren?: Date;
}

async function zalozKlienta(klient: NovyKlient): Promise<{ id: string; email: string }> {
  const email = `dup-${pripona()}@example.test`;
  const [radek] = await dotaz<{ id: string }>(
    `INSERT INTO "clients" ("id", "name", "email", "phone", "sourceId", "consentMarketingAt",
                            "smartemailingOptedOutAt", "programAccess", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::"ProgramAccess", $8, now())
     RETURNING "id"`,
    [
      klient.jmeno,
      email,
      klient.telefon ?? null,
      klient.sourceId ?? (await zdroj()),
      klient.souhlas ?? null,
      klient.odhlaseni ?? null,
      klient.pristup ?? "NEPOVOLEN",
      klient.vytvoren ?? new Date(),
    ],
  );
  return { id: radek!.id, email };
}

/** Objednávka s jedním produktem ze seedu. */
async function zalozObjednavku(clientId: string, zaplacena: boolean) {
  const [produkt] = await dotaz<{ id: string }>(
    `SELECT "id" FROM "products" WHERE "deletedAt" IS NULL LIMIT 1`,
  );
  const [objednavka] = await dotaz<{ id: string }>(
    `INSERT INTO "orders" ("id", "name", "clientId", "status", "currency", "paidAt",
                           "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Test', $1, $2::"OrderStatus", 'CZK',
             CASE WHEN $3 THEN now() ELSE NULL END, now(), now())
     RETURNING "id"`,
    [clientId, zaplacena ? "ZAPLACENO" : "NOVA", zaplacena],
  );
  await dotaz(
    `INSERT INTO "order_items" ("id", "orderId", "productId", "quantity")
     VALUES (gen_random_uuid()::text, $1, $2, 1)`,
    [objednavka!.id, produkt!.id],
  );
}

const dvojice = (page: import("@playwright/test").Page, jmeno: string) =>
  // Podle popisku dvojice — upozornění v rohu je taky položka seznamu a jméno obsahuje.
  page.getByRole("listitem", { name: new RegExp(jmeno) });

test.describe("duplicity očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("stejný telefon: sloučení přesune objednávku, souhlas i přístup", async ({ page }) => {
    const telefon = nahodnyTelefon();
    const znacka = pripona();
    // Starší karta s objednávkou zůstane (předvybraná — víc objednávek).
    const zustava = await zalozKlienta({
      jmeno: `Dup Hlavni ${znacka}`,
      telefon,
      vytvoren: new Date(Date.now() - 10 * 86_400_000),
    });
    await zalozObjednavku(zustava.id, true);
    // Druhá karta: novější souhlas a povolený přístup — obojí se převezme.
    const odchazi = await zalozKlienta({
      jmeno: `Dup Druha ${znacka}`,
      telefon,
      souhlas: new Date(),
      pristup: "POVOLEN",
    });
    await zalozObjednavku(odchazi.id, false);

    // Pruh na kartě ukazuje na druhou kartu.
    await otevriAzUvidis(page, `/klienti/${zustava.id}`, page.getByText("Možná duplicita"));
    await expect(page.getByRole("link", { name: `Dup Druha ${znacka}` })).toBeVisible();

    const polozka = dvojice(page, `Dup Hlavni ${znacka}`);
    await otevriAzUvidis(page, "/klienti/duplicity", polozka);
    await expect(polozka.getByText("stejný telefon")).toBeVisible();
    await polozka.getByRole("button", { name: "Sloučit" }).click();

    const okno = page.getByRole("dialog", { name: "Sloučit dvě karty klienta" });
    await expect(okno).toContainText("nelze vzít zpět");
    await expect(
      okno.getByRole("radio", { name: new RegExp(`Dup Hlavni ${znacka}`) }),
    ).toBeChecked();

    // Zrušit nic neudělá.
    await okno.getByRole("button", { name: "Zrušit" }).click();
    await expect(polozka).toBeVisible();

    await polozka.getByRole("button", { name: "Sloučit" }).click();
    await okno.getByRole("button", { name: "Sloučit" }).click();
    await cekejNaUspech(page, /Sloučeno do karty/);
    await expect(polozka).toHaveCount(0);

    const [hlavni] = await dotaz<{
      objednavek: number;
      pristup: string;
      souhlas: Date | null;
    }>(
      `SELECT (SELECT count(*)::int FROM "orders" o WHERE o."clientId" = c."id") AS "objednavek",
              c."programAccess"::text AS "pristup", c."consentMarketingAt" AS "souhlas"
       FROM "clients" c WHERE c."id" = $1`,
      [zustava.id],
    );
    expect(hlavni!.objednavek).toBe(2);
    expect(hlavni!.pristup).toBe("POVOLEN");
    expect(hlavni!.souhlas).not.toBeNull();

    const [druha] = await dotaz<{ smazana: boolean; kam: string | null }>(
      `SELECT "deletedAt" IS NOT NULL AS "smazana", "mergedIntoId" AS "kam"
       FROM "clients" WHERE "id" = $1`,
      [odchazi.id],
    );
    expect(druha!.smazana).toBe(true);
    expect(druha!.kam).toBe(zustava.id);

    // Ve Smazaných je vidět, kam se sloučila, a nadobro smazat nejde.
    const radek = page.getByRole("row").filter({ hasText: `Dup Druha ${znacka}` });
    await otevriAzUvidis(page, "/smazane", radek);
    await expect(radek).toContainText(`sloučeno do karty Dup Hlavni ${znacka}`);
    await expect(radek.getByRole("button", { name: "Trvale smazat" })).toBeDisabled();
  });

  test("novější odhlášení na zůstávající kartě souhlas nevrátí", async ({ page }) => {
    const telefon = nahodnyTelefon();
    const znacka = pripona();
    const zustava = await zalozKlienta({
      jmeno: `Dup Odhlaseny ${znacka}`,
      telefon,
      odhlaseni: new Date(),
    });
    await zalozObjednavku(zustava.id, false);
    await zalozKlienta({
      jmeno: `Dup Souhlas ${znacka}`,
      telefon,
      souhlas: new Date(Date.now() - 30 * 86_400_000),
    });

    const polozka = dvojice(page, `Dup Odhlaseny ${znacka}`);
    await otevriAzUvidis(page, "/klienti/duplicity", polozka);
    await polozka.getByRole("button", { name: "Sloučit" }).click();
    const okno = page.getByRole("dialog", { name: "Sloučit dvě karty klienta" });
    await okno.getByRole("radio", { name: new RegExp(`Dup Odhlaseny ${znacka}`) }).check();
    await okno.getByRole("button", { name: "Sloučit" }).click();
    await cekejNaUspech(page, /Sloučeno do karty/);

    const [hlavni] = await dotaz<{ souhlas: Date | null }>(
      `SELECT "consentMarketingAt" AS "souhlas" FROM "clients" WHERE "id" = $1`,
      [zustava.id],
    );
    expect(hlavni!.souhlas).toBeNull();
  });

  test("trychtýř počítá nové klienty, objednávky a platby podle zdroje", async ({ page }) => {
    const nazevZdroje = `Zdroj Trychtyr ${pripona()}`;
    const [zdrojTestu] = await dotaz<{ id: string }>(
      `INSERT INTO "client_sources" ("id", "name", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, now()) RETURNING "id"`,
      [nazevZdroje],
    );
    const zaplatil = await zalozKlienta({
      jmeno: `Tr Platil ${pripona()}`,
      sourceId: zdrojTestu!.id,
    });
    await zalozObjednavku(zaplatil.id, true);
    const objednal = await zalozKlienta({
      jmeno: `Tr Objednal ${pripona()}`,
      sourceId: zdrojTestu!.id,
    });
    await zalozObjednavku(objednal.id, false);
    await zalozKlienta({ jmeno: `Tr Nic ${pripona()}`, sourceId: zdrojTestu!.id });
    await zalozKlienta({ jmeno: `Tr Nic ${pripona()}`, sourceId: zdrojTestu!.id });

    const radek = page
      .getByRole("table", { name: "Trychtýř podle zdroje" })
      .getByRole("row")
      .filter({ hasText: nazevZdroje });
    await otevriAzUvidis(page, "/dashboard", radek);
    await expect(page.getByText("Konverzní trychtýř")).toBeVisible();
    await expect(radek.getByRole("cell").nth(1)).toHaveText("4");
    await expect(radek.getByRole("cell").nth(2)).toHaveText("2 (50 %)");
    await expect(radek.getByRole("cell").nth(3)).toHaveText("1 (25 %)");
  });
});

test.describe("duplicity očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("stejné jméno: vidí návrh, sloučit nemůže, Nejsou stejný člověk ho skryje", async ({
    page,
  }) => {
    // Stejné jméno bez ohledu na diakritiku a velikost písmen.
    const znacka = pripona();
    const prvni = await zalozKlienta({
      jmeno: `Jiří Dvojník ${znacka}`,
      telefon: nahodnyTelefon(),
    });
    const druhy = await zalozKlienta({
      jmeno: `JIRI DVOJNIK ${znacka}`,
      telefon: nahodnyTelefon(),
    });

    await otevriAzUvidis(page, `/klienti/${prvni.id}`, page.getByText("Možná duplicita"));
    await expect(page.getByText("stejné jméno")).toBeVisible();

    const polozka = dvojice(page, `Jiří Dvojník ${znacka}`);
    await otevriAzUvidis(page, "/klienti/duplicity", polozka);
    await expect(polozka.getByRole("button", { name: "Sloučit" })).toHaveCount(0);

    await polozka.getByRole("button", { name: "Nejsou stejný člověk" }).click();
    await cekejNaUspech(page, /nejde o stejného člověka/);
    await expect(polozka).toHaveCount(0);

    const [zaznam] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "client_not_duplicates"
       WHERE ("clientAId" = $1 AND "clientBId" = $2) OR ("clientAId" = $2 AND "clientBId" = $1)`,
      [prvni.id, druhy.id],
    );
    expect(zaznam!.pocet).toBe(1);

    // Pruh na kartě zmizel taky.
    await page.goto(`/klienti/${prvni.id}`);
    await expect(page.getByRole("heading", { name: `Jiří Dvojník ${znacka}` })).toBeVisible();
    await expect(page.getByText("Možná duplicita")).toHaveCount(0);
  });
});

test.describe("duplicity na telefonu", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("přehled i okno sloučení nepřečnívají", { tag: "@telefon" }, async ({ page }) => {
    test.skip(!jeMobil(page), "Týká se jen telefonu.");

    const telefon = nahodnyTelefon();
    const znacka = pripona();
    await zalozKlienta({ jmeno: `Dup Mobil Dlouhe Jmeno ${znacka}`, telefon });
    await zalozKlienta({ jmeno: `Dup Mobil Druhe ${znacka}`, telefon });

    const polozka = dvojice(page, `Dup Mobil Druhe ${znacka}`);
    await otevriAzUvidis(page, "/klienti/duplicity", polozka);
    await bezVodorovnehoPosuvu(page);

    await polozka.getByRole("button", { name: "Sloučit" }).click();
    await expect(page.getByRole("dialog", { name: "Sloučit dvě karty klienta" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);
  });
});
