import { expect, test } from "@playwright/test";

import {
  cekejNaUspech,
  dotaz,
  nahodnaAdresa,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import { zalozKlientaSUctem, zalozKurz, zalozProdukt, zaplatProdukt } from "./pomocne-klient";

/**
 * Připomínka webináře (Fáze 5C, Jakub 11. 10. 2026).
 *
 * - Plánovač pošle připomínku **den předem** a **hodinu předem** klientům
 *   s účtem, kterým se webinář ukazuje; každou jen jednou.
 * - Administrátor ji u webináře vypne; změna začátku připomínky vynuluje.
 * - Že odešla (a kolika klientům dorazila), vidí u webináře každý přihlášený.
 *
 * Testy používají jen webináře „pro kupce kurzu“ s vlastním kurzem — webinář
 * pro všechny nebo pro členy by šel všem klientům v testovací databázi
 * a rozbil jiným testům počty e-mailů. Pravidla publika jsou společná
 * s tím, co klient vidí (`pristup.ts`), a hlídá je `vzdelavani.spec.ts`.
 */

const MAILPIT = "http://mailpit:8025";
/** Stejná hodnota jako `PLANOVAC_KEY` služby `e2e` v `compose.yaml`. */
const KLIC_PLANOVACE = "e2e-planovac-klic-nepouzivat-nikde-jinde-0001";

async function emaily(komu: string): Promise<{ Subject: string; Text: string }[]> {
  const hledani = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${komu}"`)}`,
  );
  const { messages } = (await hledani.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()),
  );
}

/** Webinář pro kupce kurzu. `kdy` je SQL výraz pro začátek. */
async function zalozWebinar(nazev: string, courseId: string, kdy: string, pripominka = true) {
  const [webinar] = await dotaz<{ id: string }>(
    `INSERT INTO "webinars" ("id", "title", "startsAt", "durationMinutes", "joinUrl", "audience",
                             "courseId", "updatedAt", "remindersEnabled")
     VALUES ($1, $2, ${kdy}, 60, 'https://example.com/webinar-pripominka', 'KURZ', $3, now(), $4)
     RETURNING "id"`,
    [`e2ewebinar${pripona()}${pripona()}`, nazev, courseId, pripominka],
  );
  return webinar!.id;
}

/** Zítra v 19:00 pražského času. */
const ZITRA_VECER = `(date_trunc('day', now() AT TIME ZONE 'Europe/Prague') + interval '1 day 19 hours') AT TIME ZONE 'Europe/Prague'`;

test.describe("připomínka webináře", () => {
  test("den předem i hodinu předem kupcům kurzu, každá jednou; vypnutá nepřijde", async ({
    request,
    browser,
  }) => {
    const produkt = await zalozProdukt(`E2E Kurz webinář ${pripona()}`);
    const kurz = await zalozKurz(produkt, `Kurz s webinářem ${pripona()}`, ["Úvod"]);
    const kupec = await zalozKlientaSUctem(`Webinář Kupec ${pripona()}`);
    const jiny = await zalozKlientaSUctem(`Webinář Jiný ${pripona()}`);
    await zaplatProdukt(kupec.id, produkt);

    const zitra = `Zítřejší webinář ${pripona()}`;
    const brzy = `Webinář za hodinu ${pripona()}`;
    const vypnuty = `Webinář bez připomínky ${pripona()}`;
    const zitraId = await zalozWebinar(zitra, kurz, ZITRA_VECER);
    const brzyId = await zalozWebinar(brzy, kurz, "now() + interval '60 minutes'");
    await zalozWebinar(vypnuty, kurz, ZITRA_VECER, false);

    const spust = () =>
      request.post("/api/planovac", {
        headers: { Authorization: `Bearer ${KLIC_PLANOVACE}`, "x-forwarded-for": nahodnaAdresa() },
      });
    expect((await spust()).status()).toBe(200);

    await expect(async () => {
      const posta = await emaily(kupec.email);
      const den = posta.find((e) => e.Subject === "Připomínka webináře");
      const hodina = posta.find((e) => e.Subject === "Webinář začíná za hodinu");
      expect(den?.Text).toContain(zitra);
      expect(den?.Text).toContain("https://example.com/webinar-pripominka");
      expect(hodina?.Text).toContain(brzy);
    }).toPass({ timeout: 20_000 });

    // Druhé spuštění nic nezdvojí, vypnutý webinář ani cizí klient nic.
    expect((await spust()).status()).toBe(200);
    await new Promise((hotovo) => setTimeout(hotovo, 2_000));
    const posta = await emaily(kupec.email);
    expect(posta).toHaveLength(2);
    expect(posta.some((e) => e.Text.includes(vypnuty))).toBe(false);
    expect(await emaily(jiny.email)).toHaveLength(0);

    const [stav] = await dotaz<{ den: number; hodina: number; denUBrzkeho: boolean }>(
      `SELECT (SELECT "remindedDayCount" FROM "webinars" WHERE "id" = $1) AS "den",
              (SELECT "remindedHourCount" FROM "webinars" WHERE "id" = $2) AS "hodina",
              (SELECT "remindedDayAt" IS NOT NULL FROM "webinars" WHERE "id" = $2) AS "denUBrzkeho"`,
      [zitraId, brzyId],
    );
    // U webináře „za hodinu“ se den předem už neposílá, jen se odškrtne.
    expect(stav).toMatchObject({ den: 1, hodina: 1, denUBrzkeho: true });

    // Tým vidí u webináře, že připomínka odešla.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    const stranka = await tym.newPage();
    await otevriAzUvidis(
      stranka,
      `/vzdelavani/webinare/${zitraId}`,
      stranka.getByText(/den předem .*, doručeno 1 klientovi · hodinu předem zatím ne/),
    );
    await tym.close();
  });
});

test.describe("připomínka webináře očima administrátora", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("změna začátku připomínky vynuluje, připomínku jde vypnout", async ({ page }) => {
    const produkt = await zalozProdukt(`E2E Kurz přeložení ${pripona()}`);
    const kurz = await zalozKurz(produkt, `Kurz přeložení ${pripona()}`, ["Úvod"]);
    const nazev = `Přeložený webinář ${pripona()}`;
    const id = await zalozWebinar(nazev, kurz, ZITRA_VECER);
    await dotaz(
      `UPDATE "webinars" SET "remindedDayAt" = now(), "remindedDayCount" = 3 WHERE "id" = $1`,
      [id],
    );

    await otevriAzUvidis(
      page,
      `/vzdelavani/webinare/${id}`,
      page.getByText(/den předem .*, doručeno 3 klientům/),
    );
    await page.getByRole("button", { name: "Upravit webinář" }).click();
    const okno = page.getByRole("dialog");
    const pripominka = okno.getByLabel(/Poslat klientům připomínku/);
    await expect(pripominka).toBeChecked();
    await okno.getByLabel("Začátek").fill("2030-06-20T18:00");
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Webinář je uložený: ${nazev}.`);
    await expect(page.getByText("den předem zatím ne")).toBeVisible();

    await page.getByRole("button", { name: "Upravit webinář" }).click();
    await page
      .getByRole("dialog")
      .getByLabel(/Poslat klientům připomínku/)
      .uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, `Webinář je uložený: ${nazev}.`);
    await expect(page.getByText("Připomínka: vypnutá")).toBeVisible();
  });
});
