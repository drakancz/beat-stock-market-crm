import { expect, test } from "@playwright/test";

import { bezVodorovnehoPosuvu, cekejNaUspech, dotaz, pripona, stavPrihlaseni } from "./pomocne";
import {
  lekceKurzu,
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozKurz,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Minikurz zdarma (Platforma B, Jakub 5. 11. 2026, docs/funkce/vzdelavani.md).
 *
 * | Kdo           | Smí                                                              |
 * | ------------- | ---------------------------------------------------------------- |
 * | nepřihlášený  | na `/ucet/kurz-zdarma/[id]` číst lekce zdarma (text a video)     |
 * | klient        | totéž, odkaz v Kurzech u kurzu, který nemá                       |
 * | uživatel      | v CRM vidět, které lekce jsou zdarma; měnit ne                   |
 * | administrátor | lekci zdarma zapnout a vypnout                                   |
 *
 * Kvíz, materiály ani odškrtnutí u lekce zdarma bez nákupu ne.
 */

const ADRESA_WEBU = "https://example.com/kurz-ukazka";

/** Kurz se třemi lekcemi, první zdarma (ta má i video a kvíz). */
async function kurzSUkazkou(zverejneny = true) {
  const produkt = await zalozProdukt(`E2E Minikurz ${pripona()}`, "KURZ", ADRESA_WEBU);
  const nazev = `Minikurz ${pripona()}`;
  const kurzId = await zalozKurz(
    produkt,
    nazev,
    ["Lekce zdarma", "Placená druhá", "Placená třetí"],
    zverejneny,
  );
  const [zdarma, druha, treti] = await lekceKurzu(kurzId);
  await dotaz(`UPDATE "course_lessons" SET "freePreview" = true WHERE "id" = $1`, [zdarma]);
  await dotaz(
    `INSERT INTO "lesson_quizzes" ("id", "lessonId", "questions", "updatedAt")
     VALUES ($1, $2, $3::jsonb, now())`,
    [
      `e2ekviz${pripona()}${pripona()}`,
      zdarma,
      JSON.stringify([{ otazka: "Tajná otázka kvízu?", moznosti: ["Ano", "Ne"], spravna: 0 }]),
    ],
  );
  return { produkt, nazev, kurzId, zdarma: zdarma!, druha: druha!, treti: treti! };
}

test.describe("veřejná ukázka bez přihlášení", () => {
  test(
    "ukáže jen lekce zdarma, ostatní se zámkem, bez kvízu",
    { tag: "@telefon" },
    async ({ browser }) => {
      const { nazev, kurzId } = await kurzSUkazkou();
      const page = await prohlizecKlienta(browser);

      const odpoved = await page.goto(`/ucet/kurz-zdarma/${kurzId}`);
      expect(odpoved?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: nazev, level: 1 })).toBeVisible();
      await expect(page.getByText("Ukázka zdarma · 1 lekce z 3")).toBeVisible();

      // Lekce zdarma i s textem a videem.
      await expect(page.getByRole("heading", { name: "Lekce zdarma", level: 2 })).toBeVisible();
      await expect(page.getByText("Text lekce Lekce zdarma.")).toBeVisible();
      await expect(page.locator('iframe[title="Video: Lekce zdarma"]')).toHaveCount(1);

      // Placené lekce jen názvem — jejich text ze serveru vůbec nepřijde.
      await expect(page.getByRole("navigation", { name: "Lekce kurzu" })).toContainText(
        "Placená druhá",
      );
      const html = await page.content();
      expect(html).not.toContain("Text lekce Placená druhá");
      expect(html).not.toContain("Text lekce Placená třetí");
      // Kvíz ani správné odpovědi ne.
      expect(html).not.toContain("Tajná otázka kvízu");
      expect(html).not.toContain("spravna");

      // Nepřihlášený nemá účet — Koupit v klientské části ne, jen odkaz na web.
      await expect(page.getByRole("link", { name: "Koupit kurz" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Více o kurzu/ })).toHaveAttribute(
        "href",
        ADRESA_WEBU,
      );
      // Na přihlášení to nepřesměrovalo.
      await expect(page).toHaveURL(new RegExp(`/ucet/kurz-zdarma/${kurzId}$`));

      await bezVodorovnehoPosuvu(page);
      await page.context().close();
    },
  );

  test("kurz bez lekce zdarma, koncept a nesmysl vrací 404", async ({ browser }) => {
    const page = await prohlizecKlienta(browser);

    // Kurz bez lekce zdarma.
    const bezUkazky = await zalozKurz(
      await zalozProdukt(`E2E Bez ukázky ${pripona()}`),
      `Bez ukázky ${pripona()}`,
      ["Jen placená"],
    );
    expect((await page.goto(`/ucet/kurz-zdarma/${bezUkazky}`))?.status()).toBe(404);

    // Koncept s lekcí zdarma.
    const koncept = await kurzSUkazkou(false);
    expect((await page.goto(`/ucet/kurz-zdarma/${koncept.kurzId}`))?.status()).toBe(404);

    // Smazaná lekce zdarma = kurz už ukázku nemá.
    const smazana = await kurzSUkazkou();
    await dotaz(`UPDATE "course_lessons" SET "deletedAt" = now() WHERE "id" = $1`, [
      smazana.zdarma,
    ]);
    expect((await page.goto(`/ucet/kurz-zdarma/${smazana.kurzId}`))?.status()).toBe(404);

    expect((await page.goto("/ucet/kurz-zdarma/neexistuje"))?.status()).toBe(404);
    await page.context().close();
  });
});

test.describe("klient a ukázka zdarma", () => {
  test(
    "klient bez kurzu najde ukázku v Kurzech a může koupit; lekci si neodškrtne",
    { tag: "@telefon" },
    async ({ browser }) => {
      const { produkt, nazev, kurzId, zdarma } = await kurzSUkazkou();
      const klient = await zalozKlientaSUctem(`Klient Ukázka ${pripona()}`);
      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);

      await page.goto("/ucet/kurzy");
      const radek = page.locator("li").filter({ hasText: nazev });
      await radek.getByRole("link", { name: "Ukázka zdarma" }).click();
      await expect(page).toHaveURL(new RegExp(`/ucet/kurz-zdarma/${kurzId}$`));
      await expect(page.getByRole("heading", { name: "Lekce zdarma", level: 2 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Koupit kurz" })).toHaveAttribute(
        "href",
        `/ucet/koupit?produkt=${produkt}`,
      );
      await bezVodorovnehoPosuvu(page);

      // Lekce v klientské části (odškrtnutí, kvíz, materiály) dál jen pro kupce.
      expect((await page.goto(`/ucet/lekce/${zdarma}`))?.status()).toBe(404);
      expect((await page.goto(`/ucet/kurzy/${kurzId}`))?.status()).toBe(404);

      // Po zaplacení ho ukázka pošle do kurzu.
      await zaplatProdukt(klient.id, produkt);
      await page.goto(`/ucet/kurz-zdarma/${kurzId}`);
      await page.getByRole("link", { name: "Přejít do kurzu" }).click();
      await expect(page).toHaveURL(new RegExp(`/ucet/kurzy/${kurzId}$`));
      await page.context().close();
    },
  );
});

test.describe("lekce zdarma v CRM", () => {
  test("administrátor zapne a vypne lekci zdarma; uživatel to nezmění ani přímo", async ({
    browser,
  }) => {
    const produkt = await zalozProdukt(`E2E Minikurz CRM ${pripona()}`);
    const kurzId = await zalozKurz(produkt, `Minikurz CRM ${pripona()}`, ["Úvodní lekce"]);
    const [lekceId] = await lekceKurzu(kurzId);
    const jeZdarma = async () =>
      (
        await dotaz<{ zdarma: boolean }>(
          `SELECT "freePreview" AS "zdarma" FROM "course_lessons" WHERE "id" = $1`,
          [lekceId],
        )
      )[0]!.zdarma;

    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const page = await admin.newPage();
    await page.goto(`/vzdelavani/kurzy/${kurzId}`);
    await expect(page.getByText("Veřejná ukázka zdarma")).toHaveCount(0);

    // S pravidlem odemknutí to server odmítne a okno zůstane otevřené.
    await page.getByRole("button", { name: "Upravit lekci: Úvodní lekce" }).click();
    let okno = page.getByRole("dialog", { name: "Upravit lekci" });
    await okno.getByLabel("Ukázková lekce zdarma").check();
    await okno.getByLabel("Dní po zakoupení kurzu").fill("7");
    await okno.getByRole("button", { name: "Uložit" }).click();
    await expect(okno.getByText(/Lekce zdarma je otevřená hned/)).toBeVisible();
    await okno.getByLabel("Dní po zakoupení kurzu").fill("");
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Uložit" }).click(),
    ]);
    await cekejNaUspech(page, "Lekce je uložená: Úvodní lekce.");
    await expect.poll(jeZdarma).toBe(true);
    const radek = page.locator("ol > li").filter({ hasText: "Úvodní lekce" });
    await expect(radek.getByText("zdarma", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `/ucet/kurz-zdarma/${kurzId}` })).toBeVisible();

    // Vypnout.
    await page.getByRole("button", { name: "Upravit lekci: Úvodní lekce" }).click();
    okno = page.getByRole("dialog", { name: "Upravit lekci" });
    await expect(okno.getByLabel("Ukázková lekce zdarma")).toBeChecked();
    await okno.getByLabel("Ukázková lekce zdarma").uncheck();
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Lekce je uložená: Úvodní lekce.");
    await expect.poll(jeZdarma).toBe(false);
    await admin.close();

    // Uživatel zopakuje administrátorovo „zapnout zdarma“ — server ho odmítne.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"]!,
        Accept: "text/x-component",
      },
      data: akce.postData() ?? "",
    });
    expect(await jeZdarma(), "uživatel nesmí lekci zdarma zapnout").toBe(false);

    // Uživatel vidí značku, ale formulář nemá.
    await dotaz(`UPDATE "course_lessons" SET "freePreview" = true WHERE "id" = $1`, [lekceId]);
    const uzivatel = await tym.newPage();
    await uzivatel.goto(`/vzdelavani/kurzy/${kurzId}`);
    await expect(uzivatel.locator("ol > li").getByText("zdarma", { exact: true })).toBeVisible();
    await expect(uzivatel.getByRole("button", { name: /Upravit lekci/ })).toHaveCount(0);
    await tym.close();
  });
});
