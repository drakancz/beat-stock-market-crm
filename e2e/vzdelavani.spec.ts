import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
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
 * Vzdělávání — krok 3C (Jakub, 4. 10. 2026).
 *
 * - **Obsah spravuje jen administrátor**, tým ho vidí.
 * - **Kurz vidí klient, který ho má zaplacený**; ostatní jen název
 *   a cizí kurz na přímé adrese dostanou 404.
 * - Lekce: text, video (jen YouTube/Vimeo), pořadí, Hotovo u klienta.
 */

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** Kurz s lekcemi rovnou v databázi (pro testy klientské části). */
async function zalozKurz(productId: string, nazev: string, lekce: string[], zverejneny = true) {
  const [kurz] = await dotaz<{ id: string }>(
    `INSERT INTO "courses" ("id", "productId", "title", "publishedAt", "updatedAt")
     VALUES ($1, $2, $3, ${zverejneny ? "now()" : "NULL"}, now())
     RETURNING "id"`,
    [`e2ekurz${pripona()}${pripona()}`, productId, nazev],
  );
  for (const [i, titulek] of lekce.entries()) {
    await dotaz(
      `INSERT INTO "course_lessons" ("id", "courseId", "title", "body", "videoUrl", "position", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        `e2elekce${pripona()}${pripona()}`,
        kurz!.id,
        titulek,
        `Text lekce ${titulek}.\n\nDruhý odstavec.`,
        i === 0 ? VIDEO : null,
        i + 1,
      ],
    );
  }
  return kurz!.id;
}

test.describe("kurzy očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("založí kurz, přidá, seřadí, upraví a smaže lekce, smaže kurz", async ({ page }) => {
    const produkt = `E2E Kurz obsah ${pripona()}`;
    await zalozProdukt(produkt);
    const nazev = `Základy ${pripona()}`;

    await page.goto("/vzdelavani");
    await page.getByRole("button", { name: "Nový kurz" }).click();
    const okno = page.getByRole("dialog", { name: "Nový kurz" });
    await vyber(page, "Kurz v ceníku", produkt);
    await okno.getByLabel("Název pro klienty").fill(nazev);
    await okno.getByLabel("Zveřejněno").check();
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Kurz je založený: ${nazev}.`);
    await expect(page.getByRole("heading", { name: new RegExp(nazev) })).toBeVisible();

    // Dvě lekce; špatný odkaz na video se odmítne.
    for (const [titulek, video] of [
      ["Úvod", "https://example.com/video"],
      ["Úvod", VIDEO],
      ["Druhá lekce", ""],
    ] as const) {
      await page.getByRole("button", { name: "Nová lekce" }).click();
      const lekce = page.getByRole("dialog", { name: "Nová lekce" });
      await lekce.getByLabel("Název").fill(titulek);
      await lekce.getByLabel("Video (nepovinné)").fill(video);
      await lekce.getByLabel("Text").fill(`Obsah ${titulek}`);
      await lekce.getByRole("button", { name: "Uložit" }).click();
      if (video.startsWith("https://example.com")) {
        await expect(lekce.getByText(/YouTube nebo Vimeo/)).toBeVisible();
        await lekce.getByRole("button", { name: "Zrušit" }).click();
        continue;
      }
      await cekejNaUspech(page, `Lekce je přidaná: ${titulek}.`);
    }

    const polozky = page.locator("ol > li");
    await expect(polozky.nth(0)).toContainText("Úvod");
    await page.getByRole("button", { name: "Posunout nahoru: Druhá lekce" }).click();
    await expect(polozky.nth(0)).toContainText("Druhá lekce");

    await page.getByRole("button", { name: "Upravit lekci: Úvod" }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit lekci" });
    await uprava.getByLabel("Název").fill("Úvod do investic");
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Lekce je uložená: Úvod do investic.");

    await page.getByRole("button", { name: "Smazat lekci: Druhá lekce" }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat lekci" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, "Smazáno: Druhá lekce.");
    await expect(page.getByText("Druhá lekce")).toHaveCount(0);

    await page.getByRole("button", { name: "Smazat", exact: true }).click();
    const smazaniKurzu = page.getByRole("dialog", { name: "Smazat kurz" });
    await smazaniKurzu.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: ${nazev}.`);
    await expect(page).toHaveURL(/\/vzdelavani$/);
    await expect(page.getByRole("link", { name: nazev })).toHaveCount(0);
  });
});

test.describe("kurzy očima uživatele", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("obsah vidí, upravovat nemůže", async ({ page }) => {
    const nazev = `Jen čtení ${pripona()}`;
    const kurzId = await zalozKurz(await zalozProdukt(`E2E Kurz čtení ${pripona()}`), nazev, [
      "První",
    ]);

    await page.goto("/vzdelavani");
    await expect(page.getByRole("heading", { name: "Vzdělávání", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nový kurz" })).toHaveCount(0);

    await otevriAzUvidis(
      page,
      `/vzdelavani/kurzy/${kurzId}`,
      page.getByText("První", { exact: true }),
    );
    await expect(page.getByRole("button", { name: "Nová lekce" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Upravit|Smazat|Posunout/ })).toHaveCount(0);
  });
});

test.describe("kurzy v klientské části", () => {
  test("klient se zaplaceným kurzem projde lekce a odškrtne je", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Kurz ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz klient ${pripona()}`);
    const nazev = `Investování ${pripona()}`;
    const kurzId = await zalozKurz(produkt, nazev, ["Lekce jedna", "Lekce dvě"]);
    await zaplatProdukt(klient.id, produkt);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.getByRole("link", { name: "Kurzy" }).click();
    await page.getByRole("link", { name: nazev }).click();
    await expect(page.getByText("Hotovo 0 z 2 lekcí")).toBeVisible();

    await page.getByRole("link", { name: "Začít první lekcí" }).click();
    await expect(page.getByRole("heading", { name: "Lekce jedna" })).toBeVisible();
    // Video se vkládá z YouTube bez cookies, ne z uložené adresy.
    await expect(page.locator("iframe")).toHaveAttribute(
      "src",
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
    );
    await page.getByRole("button", { name: "Označit jako hotovou" }).click();
    await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    await page.getByRole("link", { name: "Další lekce" }).click();
    await expect(page.getByRole("heading", { name: "Lekce dvě" })).toBeVisible();

    await page.goto(`/ucet/kurzy/${kurzId}`);
    await expect(page.getByText("Hotovo 1 z 2 lekcí")).toBeVisible();
    await expect(page.getByRole("link", { name: "Pokračovat" })).toBeVisible();
    await page.context().close();
  });

  test("kurz bez zaplacení: jen název, obsah 404, koncept vůbec", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Bez Kurzu ${pripona()}`);
    const nazev = `Cizí kurz ${pripona()}`;
    const kurzId = await zalozKurz(
      await zalozProdukt(`E2E Kurz cizí ${pripona()}`, "KURZ", "https://example.com/kurz"),
      nazev,
      ["Tajná lekce"],
    );
    const koncept = `Koncept ${pripona()}`;
    await zalozKurz(await zalozProdukt(`E2E Kurz koncept ${pripona()}`), koncept, ["X"], false);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.goto("/ucet/kurzy");
    await expect(page.getByText("Zatím nemáte žádný kurz.")).toBeVisible();
    await expect(page.getByText(nazev)).toBeVisible();
    await expect(page.getByRole("link", { name: nazev })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Více o kurzu" }).first()).toHaveAttribute(
      "href",
      /^https:\/\//,
    );
    await expect(page.getByText(koncept)).toHaveCount(0);

    const odpoved = await page.goto(`/ucet/kurzy/${kurzId}`);
    expect(odpoved?.status()).toBe(404);
    await expect(page.getByText("Tajná lekce")).toHaveCount(0);
    await page.context().close();
  });
});

/** Platné (nebo už skončené) členství přímo v databázi. */
async function dejClenstvi(clientId: string, dnuDoKonce: number) {
  const produkt = await zalozProdukt(`E2E Členství ${pripona()}`, "CLENSTVI");
  await dotaz(
    `INSERT INTO "product_validities" ("id", "clientId", "productId", "validUntil", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2,
             (date_trunc('day', now() AT TIME ZONE 'Europe/Prague') + make_interval(days => $3))
               AT TIME ZONE 'Europe/Prague',
             now())`,
    [clientId, produkt, dnuDoKonce],
  );
}

/** Článek členské sekce přímo v databázi. */
async function zalozClanek(nazev: string, zverejneny = true) {
  await dotaz(
    `INSERT INTO "member_posts" ("id", "title", "body", "publishedAt", "updatedAt")
     VALUES ($1, $2, $3, ${zverejneny ? "now()" : "NULL"}, now())`,
    [`e2eclanek${pripona()}${pripona()}`, nazev, `Text článku ${nazev}.`],
  );
}

test.describe("členská sekce očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("přidá koncept, zveřejní ho a smaže", async ({ page }) => {
    const nazev = `Týdenní přehled ${pripona()}`;
    await page.goto("/vzdelavani/clenska-sekce");
    await page.getByRole("button", { name: "Nový článek" }).click();
    const okno = page.getByRole("dialog", { name: "Nový článek" });
    await okno.getByLabel("Název").fill(nazev);
    await okno.getByLabel("Text").fill("Co se tento týden v kurzech probíralo.");
    await okno.getByLabel("Koncept — zatím ne").check();
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Článek je přidaný: ${nazev}.`);

    const radek = page.locator("li").filter({ hasText: nazev });
    await expect(radek.getByText("Koncept", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Upravit článek: ${nazev}` }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit článek" });
    await uprava.getByLabel("Zveřejněno").check();
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Článek je uložený: ${nazev}.`);
    await expect(radek.getByText("Zveřejněno", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Smazat článek: ${nazev}` }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat článek" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Smazáno: ${nazev}.`);
    await expect(page.getByText(nazev)).toHaveCount(0);
  });
});

test.describe("členská sekce v klientské části", () => {
  test("člen čte zveřejněný článek, koncept nevidí", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Člen ${pripona()}`);
    await dejClenstvi(klient.id, 30);
    const clanek = `Pro členy ${pripona()}`;
    const koncept = `Koncept člen ${pripona()}`;
    await zalozClanek(clanek);
    await zalozClanek(koncept, false);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.getByRole("link", { name: "Členská sekce" }).click();
    await page.getByRole("link", { name: clanek }).click();
    await expect(page.getByRole("heading", { name: clanek })).toBeVisible();
    await expect(page.getByText(`Text článku ${clanek}.`)).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    await page.goto("/ucet/clenska-sekce");
    await expect(page.getByText(koncept)).toHaveCount(0);
    await page.context().close();
  });

  test("bez platného členství vysvětlení a článek 404", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Po Konci ${pripona()}`);
    // Členství skončilo včera.
    await dejClenstvi(klient.id, -1);
    const clanek = `Jen pro členy ${pripona()}`;
    await zalozClanek(clanek);
    const [radek] = await dotaz<{ id: string }>(
      `SELECT "id" FROM "member_posts" WHERE "title" = $1`,
      [clanek],
    );

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.goto("/ucet/clenska-sekce");
    await expect(page.getByText("Členská sekce je pro klienty s platným členstvím.")).toBeVisible();
    await expect(page.getByText(clanek)).toHaveCount(0);

    const odpoved = await page.goto(`/ucet/clenska-sekce/${radek!.id}`);
    expect(odpoved?.status()).toBe(404);
    await page.context().close();
  });
});

/** Webinář přímo v databázi. `zaHodin` záporné = už proběhl. */
async function zalozWebinar(
  nazev: string,
  publikum: "VSICHNI" | "CLENOVE" | "KURZ",
  courseId: string | null = null,
  zaHodin = 48,
) {
  const [webinar] = await dotaz<{ id: string }>(
    `INSERT INTO "webinars" ("id", "title", "startsAt", "durationMinutes", "joinUrl", "audience",
                             "courseId", "updatedAt")
     VALUES ($1, $2, now() + make_interval(hours => $3), 60, 'https://example.com/webinar',
             $4::"WebinarAudience", $5, now())
     RETURNING "id"`,
    [`e2ewebinar${pripona()}${pripona()}`, nazev, zaHodin, publikum, courseId],
  );
  return webinar!.id;
}

test.describe("webináře očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("naplánuje, upraví, zapíše a zruší účast, smaže", async ({ page }) => {
    const klient = await zalozKlientaSUctem(`Klient Webinář ${pripona()}`);
    const nazev = `Otázky a odpovědi ${pripona()}`;

    await page.goto("/vzdelavani/webinare");
    await page.getByRole("button", { name: "Nový webinář" }).click();
    const okno = page.getByRole("dialog", { name: "Nový webinář" });
    await okno.getByLabel("Název").fill(nazev);
    await okno.getByLabel("Začátek").fill("2030-05-14T18:00");
    await okno.getByLabel("Odkaz na připojení (nepovinné)").fill("http://nezabezpecene.cz");
    await okno.getByRole("button", { name: "Uložit" }).click();
    await expect(okno.getByText("Odkaz na připojení musí začínat https://.")).toBeVisible();
    await okno.getByLabel("Odkaz na připojení (nepovinné)").fill("https://meet.example.com/abc");
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Webinář je naplánovaný: ${nazev}.`);
    await expect(page.getByRole("heading", { name: nazev })).toBeVisible();
    await expect(page.getByText(/14\. 5\. 2030, 18:00/)).toBeVisible();

    await page.getByRole("button", { name: "Upravit webinář" }).click();
    const uprava = page.getByRole("dialog", { name: "Upravit webinář" });
    await uprava.getByLabel("Jen členové (platné členství)").check();
    await uprava.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Webinář je uložený: ${nazev}.`);
    await expect(page.getByText(/jen členové/)).toBeVisible();

    // Zápis účasti — klient dostane odznak za první webinář.
    await page.getByRole("combobox", { name: "Vyber klienta" }).click();
    await page.getByRole("combobox", { name: "Hledat klienta…" }).fill(klient.name);
    await page.getByRole("option", { name: klient.name }).click();
    await page.getByRole("button", { name: "Zapsat účast" }).click();
    await cekejNaUspech(page, `Účast je zapsaná: ${klient.name}.`);
    await expect(page.getByRole("link", { name: klient.name })).toBeVisible();
    const [odznak] = await dotaz(
      `SELECT 1 FROM "client_badges" WHERE "clientId" = $1 AND "kind" = 'PRVNI_WEBINAR'`,
      [klient.id],
    );
    expect(odznak).toBeTruthy();

    // Na iPhonu hláška o zápisu překryje tlačítko u řádku — počká se, až zmizí.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    await page.getByRole("button", { name: `Zrušit účast: účast: ${klient.name}` }).click();
    const zruseni = page.getByRole("dialog", { name: "Zrušit účast" });
    await expect(zruseni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await zruseni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, `Účast je zrušená: ${klient.name}.`);

    await page.getByRole("button", { name: "Smazat", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Smazat webinář" })
      .getByRole("button", { name: "Smazat" })
      .click();
    await cekejNaUspech(page, `Smazáno: ${nazev}.`);
    await expect(page).toHaveURL(/\/vzdelavani\/webinare$/);
  });
});

test.describe("webináře v klientské části", () => {
  test("vidí jen webináře pro sebe: všichni, členové, kupci kurzu", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Publikum ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz webinář ${pripona()}`);
    const mujKurz = await zalozKurz(produkt, `Můj kurz ${pripona()}`, ["L1"]);
    await zaplatProdukt(klient.id, produkt);
    const ciziKurz = await zalozKurz(
      await zalozProdukt(`E2E Kurz cizí web ${pripona()}`),
      `Cizí kurz ${pripona()}`,
      ["L1"],
    );

    const vsichni = `Pro všechny ${pripona()}`;
    const clenove = `Pro členy ${pripona()}`;
    const kupciMoji = `Pro můj kurz ${pripona()}`;
    const kupciCizi = `Pro cizí kurz ${pripona()}`;
    const probehly = `Proběhlý ${pripona()}`;
    await zalozWebinar(vsichni, "VSICHNI");
    await zalozWebinar(clenove, "CLENOVE");
    await zalozWebinar(kupciMoji, "KURZ", mujKurz);
    await zalozWebinar(kupciCizi, "KURZ", ciziKurz);
    const probehlyId = await zalozWebinar(probehly, "VSICHNI", null, -48);
    await dotaz(
      `INSERT INTO "webinar_attendance" ("id", "webinarId", "clientId")
       VALUES (gen_random_uuid()::text, $1, $2)`,
      [probehlyId, klient.id],
    );

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.getByRole("link", { name: "Webináře" }).click();
    await expect(page.getByText(vsichni, { exact: true })).toBeVisible();
    await expect(page.getByText(kupciMoji, { exact: true })).toBeVisible();
    await expect(page.getByText(clenove)).toHaveCount(0);
    await expect(page.getByText(kupciCizi)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Připojit se" }).first()).toHaveAttribute(
      "href",
      "https://example.com/webinar",
    );
    // Proběhlý webinář jen v seznamu účasti, bez odkazu.
    await expect(page.getByText("Webináře, kterých jste se zúčastnili")).toBeVisible();
    await expect(page.getByText(probehly)).toBeVisible();
    await bezVodorovnehoPosuvu(page);

    // S platným členstvím přibude webinář pro členy.
    await dejClenstvi(klient.id, 30);
    await page.reload();
    await expect(page.getByText(clenove, { exact: true })).toBeVisible();
    await page.context().close();
  });
});

test.describe("odznaky a karta klienta", () => {
  test("lekce dají odznaky, aktivita 4 týdny taky; tým je vidí na kartě", async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Odznaky ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz odznaky ${pripona()}`);
    const nazev = `Odznakový kurz ${pripona()}`;
    const kurzId = await zalozKurz(produkt, nazev, ["Jedna", "Dvě"]);
    await zaplatProdukt(klient.id, produkt);
    // Tři předchozí týdny v klientské části — čtvrtý přidá přihlášení.
    for (const tydnu of [1, 2, 3]) {
      await dotaz(
        `INSERT INTO "client_active_weeks" ("clientId", "week")
         VALUES ($1, to_char((now() AT TIME ZONE 'Europe/Prague') - make_interval(days => $2),
                             'IYYY-"W"IW'))`,
        [klient.id, tydnu * 7],
      );
    }

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);

    await page.goto(`/ucet/kurzy/${kurzId}`);
    await page.getByRole("link", { name: "Začít první lekcí" }).click();
    await page.getByRole("button", { name: "Označit jako hotovou" }).click();
    await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();
    await page.getByRole("link", { name: "Další lekce" }).click();
    await page.getByRole("button", { name: "Označit jako hotovou" }).click();
    await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();

    // Poslední lekce nemá Další, ale Domů — zpátky na přehled s odznaky
    // (Jakub, 5. 10. 2026).
    await expect(page.getByRole("link", { name: "Další lekce" })).toHaveCount(0);
    await page.getByRole("link", { name: "Domů" }).click();
    await expect(page).toHaveURL(/\/ucet$/);
    const odznaky = page.getByRole("list", { name: "Odznaky" });
    for (const odznak of ["První krok", "V půlce", "Kurz dokončen", "Vytrvalost"]) {
      await expect(odznaky.getByText(odznak)).toBeVisible();
    }
    await expect(odznaky.getByText(nazev).first()).toBeVisible();
    await page.context().close();

    // Tým vidí postup a odznaky na kartě klienta.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const karta = await tym.newPage();
    await karta.goto(`/klienti/${klient.id}`);
    await expect(karta.getByText(`${nazev} 2/2`)).toBeVisible();
    await expect(
      karta.getByRole("list", { name: "Odznaky" }).getByText("Kurz dokončen"),
    ).toBeVisible();
    await tym.close();
  });
});
