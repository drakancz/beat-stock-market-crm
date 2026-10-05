import { expect, test } from "@playwright/test";

import { dotaz, pripona } from "./pomocne";

/**
 * Příjem objednávek z Landing Page — `POST /api/objednavky`
 * (Jakub, 22. 9. 2026).
 *
 * Je to adresa **bez přihlášení**, chráněná jen klíčem (security.md),
 * takže se tu zkouší hlavně to, co se stane bez něj a s podvrženými daty.
 *
 * **Klíč je v `compose.yaml` u služby `e2e`** a je jen pro testy. Není to
 * klíč ke službě mimo počítač — je to heslo, kterým se cizí systém
 * prokazuje nám, takže se v testech opravdu používá a nic nikam neodchází.
 */

const KLIC = "e2e-objednavky-klic-nepouzivat-nikde-jinde";

/** Produkt ze seedu — Landing Page ho bude posílat jménem. */
const PRODUKT = "Kurz Základy investování";

/**
 * Klient z webu dostane pevný zdroj „Landing Page" (Jakub, 22. 9. 2026).
 * Zakládá ho migrace; test si jen ověří, že v testovací databázi opravdu
 * je — bez něj by příjem objednávek odmítal všechno a chyba by vypadala
 * jako chyba v kódu.
 */
test.beforeAll(async () => {
  const [zdroj] = await dotaz<{ id: string }>(
    `SELECT "id" FROM "client_sources" WHERE "id" = 'landing-page'`,
  );

  if (!zdroj) throw new Error('V testovací databázi chybí zdroj „Landing Page".');
});

test.describe("příjem objednávek z Landing Page", () => {
  /*
   * Stačí jeden prohlížeč: je to volání rozhraní, ne obrazovka. Filtruje
   * se podle názvu projektu, ne podle `browserName` — desktop i android
   * jsou oba Chrome, takže by test běžel dvakrát a zakládal dva klienty.
   *
   * Podmínka musí být v `beforeEach`, ne v `test.skip()` u describe:
   * tam se předávají jen fixtures, druhý argument je `undefined` a celý
   * soubor spadne na „Cannot read properties of undefined".
   */
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  test("bez klíče se nepřijme nic", async ({ request }) => {
    const odpoved = await request.post("/api/objednavky", {
      data: { email: "nekdo@example.test", produkty: [{ nazev: PRODUKT }] },
    });

    expect(odpoved.status()).toBe(401);
  });

  test("špatný klíč se nepřijme", async ({ request }) => {
    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": "tohle-rozhodne-neni-spravny-klic-ani-nahodou" },
      data: { email: "nekdo@example.test", produkty: [{ nazev: PRODUKT }] },
    });

    expect(odpoved.status()).toBe(401);
  });

  test("objednávka se správným klíčem založí klienta i objednávku", async ({ request }) => {
    const znacka = pripona();
    const email = `landing.${znacka}@example.test`;

    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email,
        jmeno: "Tomáš",
        prijmeni: `Dvořák ${znacka}`,
        souhlasMarketing: false,
        nemamBrokera: true,
        produkty: [{ nazev: PRODUKT, pocet: 2 }],
      },
    });

    expect(odpoved.status()).toBe(201);
    const telo = await odpoved.json();
    expect(telo.ok).toBe(true);
    // Číslo objednávky (od 24. 9. 2026) — Landing Page ho ukáže zákazníkovi.
    expect(telo.cislo).toMatch(/^\d{4}-\d{4,}$/);

    // V databázi opravdu leží objednávka s položkou a ve stavu Nová.
    const [objednavka] = await dotaz<{
      number: string;
      name: string;
      status: string;
      programAccess: string;
    }>(
      `SELECT o."number", o."name", o."status", c."programAccess"
         FROM "orders" o JOIN "clients" c ON c."id" = o."clientId"
        WHERE c."email" = $1`,
      [email],
    );

    expect(objednavka?.status).toBe("NOVA");
    expect(objednavka?.number).toBe(telo.cislo);
    // Přístup do programu (od 23. 9. 2026 u klienta) zařizuje člověk,
    // ne příjem objednávky.
    expect(objednavka?.programAccess).toBe("NEPOVOLEN");
    // Název se poskládal z produktů, protože ho Landing Page neposlala.
    expect(objednavka?.name).toContain(PRODUKT);

    const [polozka] = await dotaz<{ quantity: number }>(
      `SELECT i."quantity" FROM "order_items" i
         JOIN "orders" o ON o."id" = i."orderId"
         JOIN "clients" c ON c."id" = o."clientId"
        WHERE c."email" = $1`,
      [email],
    );
    expect(polozka?.quantity).toBe(2);

    // Diakritika přežila cestu — tělo se čte přísně jako UTF-8.
    const [klient] = await dotaz<{ name: string }>(
      `SELECT "name" FROM "clients" WHERE "email" = $1`,
      [email],
    );
    expect(klient?.name).toContain("Tomáš");
  });

  test("neznámý produkt objednávku odmítne", async ({ request }) => {
    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email: `neznamy.${pripona()}@example.test`,
        souhlasMarketing: false,
        nemamBrokera: true,
        produkty: [{ nazev: "Kurz, který v ceníku není" }],
      },
    });

    expect(odpoved.status()).toBe(400);
    const telo = await odpoved.json();
    expect(telo.chyba).toContain("v ceníku CRM není");
  });

  test("objednávka na e-mail sloučené karty skončí na zůstávající kartě", async ({ request }) => {
    // Sloučení (Jakub, 27. 9. 2026): sloučená karta leží ve Smazaných
    // s odkazem na kartu, která zůstala.
    const znacka = pripona();
    const [zdroj] = await dotaz<{ id: string }>(`SELECT "id" FROM "client_sources" LIMIT 1`);
    const [zustava] = await dotaz<{ id: string }>(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now()) RETURNING "id"`,
      [`Zustava ${znacka}`, `zustava.${znacka}@example.test`, zdroj!.id],
    );
    const staryEmail = `sloucena.${znacka}@example.test`;
    await dotaz(
      `INSERT INTO "clients" ("id", "name", "email", "sourceId", "deletedAt", "mergedIntoId", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, now(), $4, now())`,
      [`Sloucena ${znacka}`, staryEmail, zdroj!.id, zustava!.id],
    );

    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email: staryEmail,
        souhlasMarketing: false,
        nemamBrokera: true,
        produkty: [{ nazev: PRODUKT }],
      },
    });
    expect(odpoved.ok()).toBe(true);

    const [pocet] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "orders" WHERE "clientId" = $1`,
      [zustava!.id],
    );
    expect(pocet!.pocet).toBe(1);
  });

  test("smazaný produkt objednávku odmítne jako neznámý", async ({ request }) => {
    // Smazání z ceníku (Jakub, 27. 9. 2026): produkt se přestane nabízet
    // i Landing Page, ale řádek v databázi zůstává.
    const nazev = `Kurz Smazany ${pripona()}`;
    await dotaz(
      `INSERT INTO "products" ("id", "name", "kind", "netPrice", "vatRateId", "currency",
                               "active", "deletedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'KURZ', 1000, 'zakladni', 'CZK', true, now(), now(), now())`,
      [nazev],
    );

    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email: `smazany.${pripona()}@example.test`,
        souhlasMarketing: false,
        nemamBrokera: true,
        produkty: [{ nazev }],
      },
    });

    expect(odpoved.status()).toBe(400);
    expect((await odpoved.json()).chyba).toContain("v ceníku CRM není");
  });

  test("cena se z požadavku nebere", async ({ request }) => {
    // Pole `cena` schéma nezná — požadavek se odmítne celý, místo aby se
    // podvržená částka tiše použila.
    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: {
        email: `cena.${pripona()}@example.test`,
        souhlasMarketing: false,
        nemamBrokera: true,
        cena: 1,
        produkty: [{ nazev: PRODUKT }],
      },
    });

    expect(odpoved.status()).toBe(400);
  });

  test("objednávka bez produktů se odmítne", async ({ request }) => {
    const odpoved = await request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: { email: `prazdna.${pripona()}@example.test`, souhlasMarketing: false, produkty: [] },
    });

    expect(odpoved.status()).toBe(400);
  });

  /*
   * Souhlas a Smazaní (Jakub, 23. 9. 2026). Klient souhlas zaškrtává na
   * Landing Page, údaj chodí povinně; objednávka vrátí klienta ze
   * Smazaných, místo aby se odmítla.
   */

  /** Pošle objednávku se správným klíčem. */
  const objednej = (
    request: import("@playwright/test").APIRequestContext,
    data: Record<string, unknown>,
  ) =>
    request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: { produkty: [{ nazev: PRODUKT }], nemamBrokera: true, ...data },
    });

  /** Souhlas a značka Smazaných u klienta podle e-mailu. */
  const klient = async (email: string) => {
    const [radek] = await dotaz<{ id: string; souhlas: Date | null; smazan: Date | null }>(
      `SELECT "id", "consentMarketingAt" AS "souhlas", "deletedAt" AS "smazan"
         FROM "clients" WHERE "email" = $1`,
      [email],
    );
    return radek;
  };

  test("objednávka bez údaje o souhlasu se odmítne", async ({ request }) => {
    const odpoved = await objednej(request, { email: `bezsouhlasu.${pripona()}@example.test` });

    expect(odpoved.status()).toBe(400);
    expect((await odpoved.json()).chyba).toContain("souhlasMarketing");
  });

  test("zaškrtnutý souhlas dostane nový klient", async ({ request }) => {
    const email = `souhlas.${pripona()}@example.test`;
    expect((await objednej(request, { email, souhlasMarketing: true })).status()).toBe(201);

    expect((await klient(email))?.souhlas).not.toBeNull();
  });

  test("známý klient bez souhlasu ho zaškrtnutím získá", async ({ request }) => {
    const email = `znamy.${pripona()}@example.test`;
    expect((await objednej(request, { email, souhlasMarketing: false })).status()).toBe(201);
    expect((await klient(email))?.souhlas).toBeNull();

    // Druhá objednávka téhož člověka, tentokrát se zaškrtnutým souhlasem.
    expect((await objednej(request, { email, souhlasMarketing: true })).status()).toBe(201);
    expect((await klient(email))?.souhlas).not.toBeNull();
  });

  test("nezaškrtnutí dřívější souhlas neodebere", async ({ request }) => {
    const email = `ponechat.${pripona()}@example.test`;
    await objednej(request, { email, souhlasMarketing: true });
    const puvodni = (await klient(email))?.souhlas;
    expect(puvodni).not.toBeNull();

    expect((await objednej(request, { email, souhlasMarketing: false })).status()).toBe(201);
    expect((await klient(email))?.souhlas?.getTime()).toBe(puvodni?.getTime());
  });

  test("objednávka vrátí klienta ze Smazaných a přijme se", async ({ request }) => {
    const email = `smazany.${pripona()}@example.test`;
    await objednej(request, { email, souhlasMarketing: false });
    const { id } = (await klient(email))!;

    // Někdo z týmu klienta smazal (do Smazaných, jako tlačítko Smazat).
    await dotaz(`UPDATE "clients" SET "deletedAt" = now() WHERE "id" = $1`, [id]);

    const odpoved = await objednej(request, { email, souhlasMarketing: false });
    expect(odpoved.status()).toBe(201);

    // Klient je zpátky mezi klienty a má obě objednávky.
    expect((await klient(email))?.smazan).toBeNull();
    const [{ pocet }] = await dotaz<{ pocet: number }>(
      `SELECT count(*)::int AS "pocet" FROM "orders" WHERE "clientId" = $1`,
      [id],
    );
    expect(pocet).toBe(2);

    // A v auditu je vidět, že ho vrátila objednávka, ne člověk.
    const [zaznam] = await dotaz<{ userId: string | null }>(
      `SELECT "userId" FROM "audit_log" WHERE "entityId" = $1 AND "action" = 'klient.vracen-objednavkou'`,
      [id],
    );
    expect(zaznam).toBeDefined();
    expect(zaznam?.userId).toBeNull();
  });
});

/**
 * Brokeři od klienta (Jakub, 25. 9. 2026): objednávka povinně nese
 * aspoň jednoho brokera (`brokeri`, klient jich může zaškrtnout víc),
 * nebo „Nemám brokera". **Jen informace** — uloží se ke klientovi,
 * portfolio nevzniká.
 */
test.describe("brokeři v objednávce", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "Rozhraní, ne obrazovka.");
  });

  const objednej = (
    request: import("@playwright/test").APIRequestContext,
    data: Record<string, unknown>,
  ) =>
    request.post("/api/objednavky", {
      headers: { "X-API-Key": KLIC },
      data: { produkty: [{ nazev: PRODUKT }], souhlasMarketing: false, ...data },
    });

  /** Co klient o brokerech uvedl a kolik má portfolií. */
  const brokeriKlienta = async (email: string) => {
    const [radek] = await dotaz<{ uvedeni: string[]; kdy: Date | null; portfolii: string }>(
      `SELECT c."reportedBrokers" AS "uvedeni", c."brokersReportedAt" AS "kdy",
              (SELECT count(*)::text FROM "portfolios" p WHERE p."clientId" = c."id") AS "portfolii"
         FROM "clients" c WHERE c."email" = $1`,
      [email],
    );
    return radek;
  };

  test("bez brokera i s oběma údaji se objednávka odmítne", async ({ request }) => {
    const bez = await objednej(request, { email: `bezbrokera.${pripona()}@example.test` });
    expect(bez.status()).toBe(400);
    expect((await bez.json()).chyba).toContain("Chybí broker");

    const prazdny = await objednej(request, {
      email: `prazdnybroker.${pripona()}@example.test`,
      brokeri: [],
    });
    expect(prazdny.status()).toBe(400);

    const oboji = await objednej(request, {
      email: `obojibroker.${pripona()}@example.test`,
      brokeri: ["XTB"],
      nemamBrokera: true,
    });
    expect(oboji.status()).toBe(400);
    expect((await oboji.json()).chyba).toContain("ne obojí");
  });

  test("víc brokerů se uloží jako informace, portfolio nevznikne", async ({ request }) => {
    const nazev = `Broker Objednavky ${pripona()}`;
    await dotaz(`INSERT INTO "brokers" ("id", "name", "autoConnect") VALUES ($1, $2, 'ANO')`, [
      nazev.toLowerCase().replaceAll(" ", "-"),
      nazev,
    ]);
    const neznamy = `Neexistujici ${pripona()}`;
    const email = `vicebrokeru.${pripona()}@example.test`;

    // Známý broker napsaný malými písmeny se sjednotí na název z katalogu,
    // neznámý zůstane, jak ho klient napsal; dvojice se vynechá.
    const odpoved = await objednej(request, {
      email,
      brokeri: [nazev.toLowerCase(), neznamy, nazev],
    });
    expect(odpoved.status()).toBe(201);

    const klient = await brokeriKlienta(email);
    expect(klient?.uvedeni).toEqual([nazev, neznamy]);
    expect(klient?.kdy).not.toBeNull();
    expect(klient?.portfolii).toBe("0");
  });

  test("„Nemám brokera“ se uloží, další objednávka údaj přepíše", async ({ request }) => {
    const email = `nemabrokera.${pripona()}@example.test`;
    expect((await objednej(request, { email, nemamBrokera: true })).status()).toBe(201);

    let klient = await brokeriKlienta(email);
    expect(klient?.uvedeni).toEqual([]);
    expect(klient?.kdy).not.toBeNull();

    const dalsi = `Dalsi Broker ${pripona()}`;
    expect((await objednej(request, { email, brokeri: [dalsi] })).status()).toBe(201);
    klient = await brokeriKlienta(email);
    expect(klient?.uvedeni).toEqual([dalsi]);
    expect(klient?.portfolii).toBe("0");
  });
});
