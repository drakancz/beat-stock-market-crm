import { expect, test, type Page, type Request } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Rezervace konzultace (Fáze 5B, Jakub 19. 10. 2026).
 *
 * | Kdo           | Smí                                                         |
 * | ------------- | ----------------------------------------------------------- |
 * | administrátor | vypsat a smazat termín, zrušit rezervaci klienta            |
 * | uživatel      | termíny a rezervace jen vidět — ani přímým voláním akce     |
 * | klient        | rezervovat jen se zaplacenou konzultací (1 kus = 1 termín), |
 * |               | zrušit a přeložit nejpozději 24 hodin předem                |
 *
 * Termíny jsou společné pro celou testovací databázi a testy běží souběžně
 * ve třech prohlížečích — každý test si proto zakládá vlastní termíny
 * s jedinečným místem (`pripona()`) a hledá je podle něj.
 */

const MAILPIT = "http://mailpit:8025";
/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

/** Termín za `zaHodin` hodin (SQL), volitelně s tím, kdo vede. */
async function zalozTermin(zaHodin: number, misto: string, hostId: string | null = null) {
  const [termin] = await dotaz<{ id: string }>(
    `INSERT INTO "consultation_slots" ("id", "startsAt", "durationMinutes", "place", "hostId",
                                       "updatedAt")
     VALUES ($1, now() + make_interval(hours => $2), 60, $3, $4, now())
     RETURNING "id"`,
    [`e2etermin${pripona()}${pripona()}`, zaHodin, misto, hostId],
  );
  return termin!.id;
}

/** Rezervace rovnou v databázi (pro stav, který se klikáním nedá navodit). */
async function zarezervujSql(slotId: string, clientId: string) {
  const [rezervace] = await dotaz<{ id: string }>(
    `INSERT INTO "consultation_bookings" ("id", "slotId", "clientId")
     VALUES ($1, $2, $3) RETURNING "id"`,
    [`e2erez${pripona()}${pripona()}`, slotId, clientId],
  );
  await dotaz(`UPDATE "consultation_slots" SET "activeBookingId" = $1 WHERE "id" = $2`, [
    rezervace!.id,
    slotId,
  ]);
  return rezervace!.id;
}

/** Klient s účtem a zaplacenou konzultací (vlastní produkt). */
async function klientSKonzultaci(jmeno: string, kusu = 1) {
  const klient = await zalozKlientaSUctem(jmeno);
  const produkt = await zalozProdukt(`E2E Konzultace ${pripona()}`, "KONZULTACE");
  for (let i = 0; i < kusu; i += 1) await zaplatProdukt(klient.id, produkt);
  return klient;
}

async function aktivniRezervace(clientId: string) {
  return dotaz<{ id: string; slotId: string }>(
    `SELECT "id", "slotId" FROM "consultation_bookings"
      WHERE "clientId" = $1 AND "cancelledAt" IS NULL`,
    [clientId],
  );
}

async function ukolyKonzultace(clientId: string) {
  return dotaz<{ title: string }>(
    `SELECT "title" FROM "tasks"
      WHERE "clientId" = $1 AND "deletedAt" IS NULL AND "title" LIKE 'Konzultace %'`,
    [clientId],
  );
}

async function emaily(komu: string): Promise<{ Subject: string; Text: string }[]> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()),
  );
}

/** Zopakuje zachycené volání serverové akce s jiným tělem v jiném prohlížeči. */
async function zopakujAkci(page: Page, akce: Request, telo: string) {
  await page.request.post(akce.url(), {
    headers: {
      "Next-Action": akce.headers()["next-action"]!,
      "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
    data: telo,
  });
}

/** Řádek volného termínu v klientské části podle místa. */
function volnyTermin(page: Page, misto: string) {
  return page.getByTestId("volny-termin").filter({ hasText: misto });
}

/** `RRRR-MM-DDTHH:MM` v pražském čase za `dni` dní, pro pole `datetime-local`. */
function casZaDni(dni: number, hodina: number, minuta: number): string {
  const den = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + dni * 86_400_000));
  return `${den}T${String(hodina).padStart(2, "0")}:${String(minuta).padStart(2, "0")}`;
}

test.describe("konzultace — klient", () => {
  test(
    "zarezervuje, přeloží a zruší; konzultace se vrací, úkol má ten, kdo vede",
    { tag: "@telefon" },
    async ({ browser }) => {
      const [vede] = await dotaz<{ id: string }>(
        `SELECT "id" FROM "users" WHERE "active" AND "deletedAt" IS NULL LIMIT 1`,
      );
      const prvni = `Online první ${pripona()}`;
      const druhy = `Online druhý ${pripona()}`;
      await zalozTermin(48, prvni, vede!.id);
      await zalozTermin(72, druhy, vede!.id);
      const klient = await klientSKonzultaci(`Konzultace Klient ${pripona()}`);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);

      // Přehled: karta s počtem a odkazem.
      const karta = page.locator("[data-slot=card]").filter({ hasText: "Konzultace" });
      await expect(karta.getByText("Máte 1 konzultaci k rezervaci.")).toBeVisible();
      await karta.getByRole("link", { name: "Vybrat termín" }).click();
      await expect(page.getByRole("heading", { name: "Konzultace", level: 1 })).toBeVisible();
      await expect(page.getByTestId("stav-konzultaci")).toContainText("zbývá 1");

      // Rezervace s potvrzením.
      await volnyTermin(page, prvni).getByRole("button", { name: "Zarezervovat" }).click();
      const okno = page.getByRole("dialog", { name: "Zarezervovat konzultaci" });
      await expect(okno.getByText(prvni)).toBeVisible();
      await okno.getByRole("button", { name: "Zarezervovat" }).click();
      await cekejNaUspech(page, "Konzultace je zarezervovaná");
      const moje = page.getByTestId("moje-rezervace");
      await expect(moje.getByText(prvni)).toBeVisible();
      await expect(page.getByTestId("stav-konzultaci")).toContainText("zbývá 0");
      // Bez volné konzultace se volné termíny nenabízejí.
      await expect(page.getByText("Volné termíny", { exact: true })).toHaveCount(0);
      expect(await ukolyKonzultace(klient.id)).toHaveLength(1);
      await bezVodorovnehoPosuvu(page);

      // Přeložení na druhý termín.
      await moje.getByRole("button", { name: "Přeložit" }).click();
      const prelozit = page.getByRole("dialog", { name: "Přeložit konzultaci" });
      await prelozit.getByRole("radio", { name: new RegExp(druhy) }).check();
      await prelozit.getByRole("button", { name: "Přeložit" }).click();
      await cekejNaUspech(page, "Konzultace je přeložená");
      await expect(moje.getByText(druhy)).toBeVisible();
      await expect(moje.getByText(prvni)).toHaveCount(0);
      expect(await aktivniRezervace(klient.id)).toHaveLength(1);
      expect(await ukolyKonzultace(klient.id)).toHaveLength(1);

      // Zrušení s potvrzením — konzultace se vrátí, úkol zmizí.
      await moje.getByRole("button", { name: "Zrušit" }).click();
      const zrusit = page.getByRole("dialog", { name: "Zrušit rezervaci" });
      await expect(zrusit.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await zrusit.getByRole("button", { name: "Zrušit rezervaci" }).click();
      await cekejNaUspech(page, "Rezervace je zrušená");
      await expect(page.getByTestId("stav-konzultaci")).toContainText("zbývá 1");
      await expect(page.getByTestId("moje-rezervace")).toHaveCount(0);
      expect(await aktivniRezervace(klient.id)).toHaveLength(0);
      expect(await ukolyKonzultace(klient.id)).toHaveLength(0);
      await page.context().close();
    },
  );

  test(
    "bez zaplacené konzultace si nezarezervuje ani přímým voláním",
    { tag: "@telefon" },
    async ({ browser }) => {
      const misto = `Bez nároku ${pripona()}`;
      const jiny = `Bez nároku jiný ${pripona()}`;
      await zalozTermin(50, misto);
      const druhyTermin = await zalozTermin(51, jiny);
      const platici = await klientSKonzultaci(`Platící ${pripona()}`);
      const bezNaroku = await zalozKlientaSUctem(`Bez nároku ${pripona()}`);

      // Platící klient rezervuje a akce se zachytí.
      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, platici.email, platici.heslo);
      await otevriAzUvidis(page, "/ucet/konzultace", volnyTermin(page, misto));
      await volnyTermin(page, misto).getByRole("button", { name: "Zarezervovat" }).click();
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page
          .getByRole("dialog", { name: "Zarezervovat konzultaci" })
          .getByRole("button", { name: "Zarezervovat" })
          .click(),
      ]);
      await cekejNaUspech(page, "Konzultace je zarezervovaná");
      const [puvodni] = await dotaz<{ id: string }>(
        `SELECT "id" FROM "consultation_slots" WHERE "place" = $1`,
        [misto],
      );

      // Klient bez zaplacené konzultace termíny nevidí a karta na Přehledu chybí.
      const druha = await prohlizecKlienta(browser);
      await prihlasKlienta(druha, bezNaroku.email, bezNaroku.heslo);
      await expect(
        druha.locator("[data-slot=card]").filter({ hasText: "Vybrat termín" }),
      ).toHaveCount(0);
      await druha.goto("/ucet/konzultace");
      await expect(druha.getByText("Zatím nemáte zaplacenou žádnou konzultaci.")).toBeVisible();
      await expect(druha.getByText("Volné termíny", { exact: true })).toHaveCount(0);

      // Přímé volání s jeho přihlášením na jiný volný termín — server odmítne.
      await zopakujAkci(druha, akce, (akce.postData() ?? "").replace(puvodni!.id, druhyTermin));
      expect(await aktivniRezervace(bezNaroku.id)).toHaveLength(0);
      await druha.context().close();
      await page.context().close();
    },
  );

  test(
    "obsazený termín druhý nevidí ani nezabere přímým voláním",
    { tag: "@telefon" },
    async ({ browser }) => {
      const misto = `Obsazený ${pripona()}`;
      const slotId = await zalozTermin(52, misto);
      const prvni = await klientSKonzultaci(`První ${pripona()}`);
      const druhy = await klientSKonzultaci(`Druhý ${pripona()}`);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, prvni.email, prvni.heslo);
      await otevriAzUvidis(page, "/ucet/konzultace", volnyTermin(page, misto));
      await volnyTermin(page, misto).getByRole("button", { name: "Zarezervovat" }).click();
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page
          .getByRole("dialog", { name: "Zarezervovat konzultaci" })
          .getByRole("button", { name: "Zarezervovat" })
          .click(),
      ]);
      await cekejNaUspech(page, "Konzultace je zarezervovaná");

      const druha = await prohlizecKlienta(browser);
      await prihlasKlienta(druha, druhy.email, druhy.heslo);
      await druha.goto("/ucet/konzultace");
      await expect(druha.getByText("Volné termíny", { exact: true })).toBeVisible();
      expect(await druha.content()).not.toContain(misto);

      await zopakujAkci(druha, akce, akce.postData() ?? "");
      expect(await aktivniRezervace(druhy.id)).toHaveLength(0);
      const [termin] = await dotaz<{ klient: string }>(
        `SELECT b."clientId" AS "klient" FROM "consultation_slots" s
         JOIN "consultation_bookings" b ON b."id" = s."activeBookingId"
        WHERE s."id" = $1`,
        [slotId],
      );
      expect(termin?.klient).toBe(prvni.id);
      await druha.context().close();
      await page.context().close();
    },
  );

  test(
    "méně než 24 hodin předem zrušit nejde ani přímým voláním",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await klientSKonzultaci(`Pozdě ${pripona()}`, 2);
      const brzy = `Za tři hodiny ${pripona()}`;
      const pozdeji = `Za dva dny ${pripona()}`;
      const brzyRezervace = await zarezervujSql(await zalozTermin(3, brzy), klient.id);
      await zarezervujSql(await zalozTermin(49, pozdeji), klient.id);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.goto("/ucet/konzultace");
      const radekBrzy = page.getByTestId("moje-rezervace").filter({ hasText: brzy });
      await expect(radekBrzy.getByText("Změnu teď už domluvíte jen s námi.")).toBeVisible();
      await expect(radekBrzy.getByRole("button")).toHaveCount(0);

      // Zrušení pozdějšího projde a akce se zachytí...
      const radekPozdeji = page.getByTestId("moje-rezervace").filter({ hasText: pozdeji });
      await radekPozdeji.getByRole("button", { name: "Zrušit" }).click();
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page
          .getByRole("dialog", { name: "Zrušit rezervaci" })
          .getByRole("button", { name: "Zrušit rezervaci" })
          .click(),
      ]);
      await cekejNaUspech(page, "Rezervace je zrušená");
      const [zrusena] = await dotaz<{ id: string }>(
        `SELECT "id" FROM "consultation_bookings" WHERE "clientId" = $1 AND "cancelledAt" IS NOT NULL`,
        [klient.id],
      );

      // ...a s id brzké rezervace ji server odmítne.
      await zopakujAkci(page, akce, (akce.postData() ?? "").replace(zrusena!.id, brzyRezervace));
      const zbyva = await aktivniRezervace(klient.id);
      expect(zbyva.map((r) => r.id)).toEqual([brzyRezervace]);
      await page.context().close();
    },
  );

  test(
    "den předem přijde připomínka, jen jednou",
    { tag: "@telefon" },
    async ({ browser, request }) => {
      const klient = await klientSKonzultaci(`Připomenout ${pripona()}`);
      const [termin] = await dotaz<{ id: string }>(
        `INSERT INTO "consultation_slots" ("id", "startsAt", "durationMinutes", "place", "updatedAt")
       VALUES ($1, (date_trunc('day', now() AT TIME ZONE 'Europe/Prague')
                    + interval '1 day 12 hours') AT TIME ZONE 'Europe/Prague', 60, $2, now())
       RETURNING "id"`,
        [`e2etermin${pripona()}${pripona()}`, `Zítra ${pripona()}`],
      );
      await zarezervujSql(termin!.id, klient.id);

      const spust = () =>
        request.post("/api/planovac", {
          headers: {
            Authorization: `Bearer ${KLIC_PLANOVACE}`,
            "x-forwarded-for": nahodnaAdresa(),
          },
        });
      expect((await spust()).status()).toBe(200);
      await expect(async () => {
        const posta = await emaily(klient.email);
        expect(posta.filter((e) => e.Subject === "Zítra máte konzultaci")).toHaveLength(1);
      }).toPass({ timeout: 20_000 });

      expect((await spust()).status()).toBe(200);
      await new Promise((hotovo) => setTimeout(hotovo, 2_000));
      const posta = await emaily(klient.email);
      expect(posta.filter((e) => e.Subject === "Zítra máte konzultaci")).toHaveLength(1);

      // Klientská část ukazuje příští konzultaci i na Přehledu.
      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await expect(page.getByText(/Příští konzultace:/)).toBeVisible();
      await page.context().close();
    },
  );
});

test.describe("konzultace — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "vypíše termíny na dva týdny, smaže volný, zruší rezervaci; uživatel přímo nevypíše",
    { tag: "@telefon" },
    async ({ page, browser }) => {
      const misto = `Kancelář ${pripona()}`;
      await page.goto("/konzultace");
      await page.getByRole("button", { name: "Vypsat termíny" }).click();
      const okno = page.getByRole("dialog", { name: "Vypsat termíny" });
      await okno.getByLabel("Začátek").fill(casZaDni(6, 10, Math.floor(Math.random() * 60)));
      await okno.getByLabel("Kolik týdnů za sebou").fill("2");
      await okno.getByLabel("Kde (nepovinné)").fill(misto);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Vypsat" }).click(),
      ]);
      await cekejNaUspech(page, "Vypsané termíny: 2");
      const radky = page.getByTestId("termin-konzultace").filter({ hasText: misto });
      await expect(radky).toHaveCount(2);
      await bezVodorovnehoPosuvu(page);

      // Smazání volného termínu s potvrzením.
      await radky.first().getByRole("button", { name: "Smazat" }).click();
      const smazat = page.getByRole("dialog", { name: "Smazat termín" });
      await expect(smazat.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await smazat.getByRole("button", { name: "Smazat" }).click();
      await cekejNaUspech(page, "Termín je smazaný");
      await expect(radky).toHaveCount(1);

      // Klient si zbylý termín zarezervuje, administrátor rezervaci zruší.
      const klient = await klientSKonzultaci(`Zrušený ${pripona()}`);
      const [zbyly] = await dotaz<{ id: string }>(
        `SELECT "id" FROM "consultation_slots" WHERE "place" = $1 AND "deletedAt" IS NULL`,
        [misto],
      );
      await zarezervujSql(zbyly!.id, klient.id);
      await otevriAzUvidis(page, "/konzultace", radky.getByText(klient.name));
      // Termín s rezervací smazat nejde — tlačítko tam není.
      await expect(radky.getByRole("button", { name: "Smazat" })).toHaveCount(0);
      await radky.getByRole("button", { name: "Zrušit rezervaci" }).click();
      const zrusit = page.getByRole("dialog", { name: "Zrušit rezervaci" });
      await expect(zrusit.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await zrusit.getByRole("button", { name: "Zrušit rezervaci" }).click();
      await cekejNaUspech(page, `Rezervace je zrušená: ${klient.name}.`);
      await expect(radky.getByText("Volný", { exact: true })).toBeVisible();
      expect(await aktivniRezervace(klient.id)).toHaveLength(0);
      await expect(async () => {
        const posta = await emaily(klient.email);
        expect(posta.some((e) => e.Subject === "Konzultace je zrušená")).toBe(true);
      }).toPass({ timeout: 20_000 });

      // Uživatel zopakuje volání s jiným místem — server ho odmítne.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const podvrh = `Podvržený ${pripona()}`;
      await tym.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        data: (akce.postData() ?? "").replace(misto, podvrh),
      });
      const vypsane = await dotaz(`SELECT 1 FROM "consultation_slots" WHERE "place" = $1`, [
        podvrh,
      ]);
      expect(vypsane, "uživatel nesmí vypsat termín").toHaveLength(0);
      await tym.close();
    },
  );
});

test.describe("konzultace — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "vidí termíny a rezervace, ale nic nemění; na kartě klienta řádek Konzultace",
    { tag: "@telefon" },
    async ({ page }) => {
      const misto = `Pro tým ${pripona()}`;
      const klient = await klientSKonzultaci(`Viditelný ${pripona()}`);
      await zarezervujSql(await zalozTermin(60, misto), klient.id);
      await zalozTermin(61, `${misto} B`);

      await page.goto("/konzultace");
      const radky = page.getByTestId("termin-konzultace").filter({ hasText: misto });
      await expect(radky.getByText(klient.name)).toBeVisible();
      await expect(radky.getByText("Volný", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Vypsat termíny" })).toHaveCount(0);
      // Smazat a zrušit smí jen administrátor; rezervovat za klienta každý.
      await expect(radky.getByRole("button", { name: "Smazat" })).toHaveCount(0);
      await expect(radky.getByRole("button", { name: "Zrušit rezervaci" })).toHaveCount(0);
      await bezVodorovnehoPosuvu(page);

      await page.goto(`/klienti/${klient.id}`);
      await expect(page.getByText(/zaplaceno 1, využito 1, příští/)).toBeVisible();
    },
  );
});

test.describe("konzultace — rezervace za klienta", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "uživatel zarezervuje klientovi s volnou konzultací; bez ní ani přímým voláním",
    { tag: "@telefon" },
    async ({ page }) => {
      const misto = `Za klienta ${pripona()}`;
      const druhe = `Za klienta druhý ${pripona()}`;
      await zalozTermin(70, misto);
      const druhyTermin = await zalozTermin(71, druhe);
      const sNarokem = await klientSKonzultaci(`Volající ${pripona()}`);
      const bezNaroku = await zalozKlientaSUctem(`Nevolající ${pripona()}`);

      await otevriAzUvidis(
        page,
        "/konzultace",
        page.getByTestId("termin-konzultace").filter({ hasText: misto }),
      );
      const radek = page.getByTestId("termin-konzultace").filter({ hasText: misto });
      await radek.getByRole("button", { name: "Zarezervovat klientovi" }).click();
      const okno = page.getByRole("dialog", { name: "Zarezervovat klientovi" });
      await okno.getByRole("combobox", { name: "Vyber klienta" }).click();
      // Klient bez zaplacené konzultace v nabídce není.
      await page.getByRole("combobox", { name: "Hledat klienta…" }).fill(bezNaroku.name);
      await expect(page.getByRole("option", { name: bezNaroku.name })).toHaveCount(0);
      await page.getByRole("combobox", { name: "Hledat klienta…" }).fill(sNarokem.name);
      await page.getByRole("option", { name: sNarokem.name }).click();
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Zarezervovat", exact: true }).click(),
      ]);
      await cekejNaUspech(page, `Zarezervováno: ${sNarokem.name}`);
      await expect(radek.getByText(sNarokem.name)).toBeVisible();
      expect(await aktivniRezervace(sNarokem.id)).toHaveLength(1);
      await bezVodorovnehoPosuvu(page);

      // Přímé volání pro klienta bez konzultace na druhý termín — server odmítne.
      const [puvodni] = await dotaz<{ id: string }>(
        `SELECT "id" FROM "consultation_slots" WHERE "place" = $1`,
        [misto],
      );
      await zopakujAkci(
        page,
        akce,
        (akce.postData() ?? "")
          .replace(sNarokem.id, bezNaroku.id)
          .replace(puvodni!.id, druhyTermin),
      );
      expect(await aktivniRezervace(bezNaroku.id)).toHaveLength(0);
    },
  );
});

test.describe("konzultace — nepřihlášený", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("na Konzultace v CRM ani v klientské části nesmí", async ({ page }) => {
    await page.goto("/konzultace");
    await expect(page).toHaveURL(/\/prihlaseni/);
    await page.goto("/ucet/konzultace");
    await expect(page).toHaveURL(/\/ucet\/prihlaseni/);
  });
});
