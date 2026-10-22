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
  VIDEO_YOUTUBE,
  zalozKlientaSUctem,
  zalozKurz,
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

const VIDEO = VIDEO_YOUTUBE;

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
      // Na telefonu oznámení v dolním rohu tlačítko zakryje — počkat, až zmizí.
      // Kurzor nad oznámením by jeho zmizení pozdržel, proto pryč.
      await page.mouse.move(0, 0);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
      await page.getByRole("button", { name: "Nová lekce" }).click();
      const lekce = page.getByRole("dialog", { name: "Nová lekce" });
      await lekce.getByLabel("Název").fill(titulek);
      await lekce.getByLabel("Video (nepovinné)").fill(video);
      await lekce.getByLabel("Text").fill(`Obsah ${titulek}`);
      await lekce.getByRole("button", { name: "Uložit" }).click();
      if (video.startsWith("https://example.com")) {
        // „YouTube nebo Vimeo“ je i v popisu okna — hledá se hláška serveru.
        await expect(lekce.getByText(/Video musí být odkaz na YouTube nebo Vimeo/)).toBeVisible();
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
  test(
    "klient se zaplaceným kurzem projde lekce a odškrtne je",
    { tag: "@telefon" },
    async ({ browser }) => {
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
    },
  );

  test(
    "kurz bez zaplacení: jen název, obsah 404, koncept vůbec",
    { tag: "@telefon" },
    async ({ browser }) => {
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
    },
  );
});

/**
 * Hodnocení lekce „Pomohla vám lekce?“ (Fáze 5C, Jakub 18. 10. 2026).
 * Hodnotí jen klient s kurzem, 1–5, smí změnit; tým vidí průměr a kartu.
 */
async function lekceKurzu(kurzId: string): Promise<string[]> {
  const radky = await dotaz<{ id: string }>(
    `SELECT "id" FROM "course_lessons" WHERE "courseId" = $1 ORDER BY "position"`,
    [kurzId],
  );
  return radky.map((radek) => radek.id);
}

async function hodnoceniVDatabazi(clientId: string) {
  return dotaz<{ lessonId: string; stars: number }>(
    `SELECT "lessonId", "stars" FROM "lesson_ratings" WHERE "clientId" = $1`,
    [clientId],
  );
}

test.describe("hodnocení lekce v klientské části", () => {
  test("klient ohodnotí lekci a hodnocení změní", { tag: "@telefon" }, async ({ browser }) => {
    const klient = await zalozKlientaSUctem(`Klient Hodnotí ${pripona()}`);
    const produkt = await zalozProdukt(`E2E Kurz hodnocení ${pripona()}`);
    const kurzId = await zalozKurz(produkt, `Hodnocený ${pripona()}`, ["Lekce k hodnocení"]);
    await zaplatProdukt(klient.id, produkt);
    const [lekceId] = await lekceKurzu(kurzId);

    const page = await prohlizecKlienta(browser);
    await prihlasKlienta(page, klient.email, klient.heslo);
    await page.goto(`/ucet/lekce/${lekceId}`);
    const skupina = page.getByRole("group", { name: "Pomohla vám lekce?" });
    await expect(skupina).toBeVisible();

    await skupina.getByRole("button", { name: "4 z 5" }).click();
    await expect(page.getByText("Děkujeme za hodnocení.")).toBeVisible();
    await expect
      .poll(() => hodnoceniVDatabazi(klient.id))
      .toEqual([{ lessonId: lekceId, stars: 4 }]);

    // Po načtení stránky zůstane vybrané; změna přepíše, nepřidá druhé.
    await page.reload();
    await expect(skupina.getByRole("button", { name: "4 z 5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await skupina.getByRole("button", { name: "2 z 5" }).click();
    await expect
      .poll(() => hodnoceniVDatabazi(klient.id))
      .toEqual([{ lessonId: lekceId, stars: 2 }]);
    await bezVodorovnehoPosuvu(page);
    await page.context().close();
  });

  test(
    "cizí lekci ani hodnotu mimo 1–5 nejde poslat ani přímým voláním",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Klient Podvrh ${pripona()}`);
      const produkt = await zalozProdukt(`E2E Kurz vlastní ${pripona()}`);
      const [vlastni] = await lekceKurzu(
        await zalozKurz(produkt, `Vlastní ${pripona()}`, ["Moje"]),
      );
      await zaplatProdukt(klient.id, produkt);
      const [cizi] = await lekceKurzu(
        await zalozKurz(await zalozProdukt(`E2E Kurz cizí h ${pripona()}`), `Cizí ${pripona()}`, [
          "Cizí lekce",
        ]),
      );

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.goto(`/ucet/lekce/${vlastni}`);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page.getByRole("button", { name: "5 z 5" }).click(),
      ]);
      const telo = akce.postData() ?? "";
      expect(telo).toContain(`"${vlastni}",5`);
      const posli = (data: string) =>
        page.request.post(akce.url(), {
          headers: {
            "Next-Action": akce.headers()["next-action"]!,
            "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
            Accept: "text/x-component",
          },
          data,
        });
      await expect.poll(() => hodnoceniVDatabazi(klient.id)).toHaveLength(1);

      await posli(telo.replace(`"${vlastni}",5`, `"${cizi}",5`));
      await posli(telo.replace(`"${vlastni}",5`, `"${vlastni}",7`));
      await posli(telo.replace(`"${vlastni}",5`, `"${vlastni}",0`));
      expect(await hodnoceniVDatabazi(klient.id)).toEqual([{ lessonId: vlastni, stars: 5 }]);
      await page.context().close();
    },
  );
});

test.describe("hodnocení lekce v CRM", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("u lekce průměr a počet, na kartě hodnocení klienta", async ({ page }) => {
    const produkt = await zalozProdukt(`E2E Kurz průměr ${pripona()}`);
    const kurzId = await zalozKurz(produkt, `Průměr ${pripona()}`, ["Hodnocená", "Bez hodnocení"]);
    const [lekceId] = await lekceKurzu(kurzId);
    const prvni = await zalozKlientaSUctem(`Klient Pět ${pripona()}`);
    const druhy = await zalozKlientaSUctem(`Klient Čtyři ${pripona()}`);
    for (const [klient, hvezd] of [
      [prvni, 5],
      [druhy, 4],
    ] as const) {
      await zaplatProdukt(klient.id, produkt);
      await dotaz(
        `INSERT INTO "lesson_ratings" ("id", "clientId", "lessonId", "stars", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, now())`,
        [klient.id, lekceId, hvezd],
      );
    }

    await otevriAzUvidis(
      page,
      `/vzdelavani/kurzy/${kurzId}`,
      page.getByText("Hodnocená", { exact: true }),
    );
    await expect(page.getByText("Hodnocení 4,5 z 5 · 2 hodnocení")).toBeVisible();
    await expect(page.getByText("Zatím bez hodnocení")).toBeVisible();

    await page.goto(`/klienti/${druhy.id}`);
    await expect(page.getByText("Hodnocená 4/5")).toBeVisible();
  });
});

/**
 * Postupné odemykání lekcí (Fáze 5C, Jakub 18. 10. 2026): N dní po
 * zakoupení, od data, po dokončení předchozí. Zamčená lekce = jen název
 * a kdy se otevře, obsah 404 a akce ji odmítnou.
 */
test.describe("postupné odemykání v klientské části", () => {
  test(
    "dny po zakoupení a datum: zamčená lekce 404, pak se otevře",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Klient Odemyká ${pripona()}`);
      const produkt = await zalozProdukt(`E2E Kurz odemykání ${pripona()}`);
      const kurzId = await zalozKurz(produkt, `Postupný ${pripona()}`, [
        "Hned",
        "Po třech dnech",
        "Od data",
      ]);
      const objednavka = await zaplatProdukt(klient.id, produkt);
      const [hned, poDnech, odData] = await lekceKurzu(kurzId);
      await dotaz(`UPDATE "course_lessons" SET "unlockAfterDays" = 3 WHERE "id" = $1`, [poDnech]);
      await dotaz(
        `UPDATE "course_lessons" SET "unlockOn" = now() + interval '5 days' WHERE "id" = $1`,
        [odData],
      );

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.goto(`/ucet/kurzy/${kurzId}`);
      const seznam = page.getByRole("list").filter({ hasText: "Po třech dnech" });
      await expect(seznam.getByRole("link", { name: /Hned/ })).toBeVisible();
      await expect(seznam.getByRole("link", { name: /Po třech dnech/ })).toHaveCount(0);
      await expect(seznam.getByText(/^Otevře se \d+\. \d+\. \d{4}\.$/)).toHaveCount(2);
      await bezVodorovnehoPosuvu(page);

      // Přímá adresa zamčené lekce je 404 a obsah neprozradí.
      const odpoved = await page.goto(`/ucet/lekce/${poDnech}`);
      expect(odpoved?.status()).toBe(404);
      await expect(page.getByText("Text lekce Po třech dnech")).toHaveCount(0);

      // Hotovo u zamčené lekce nejde ani přímým voláním akce.
      await page.goto(`/ucet/lekce/${hned}`);
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page.getByRole("button", { name: "Označit jako hotovou" }).click(),
      ]);
      const telo = akce.postData() ?? "";
      expect(telo).toContain(hned);
      await page.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        data: telo.replace(hned, poDnech),
      });
      const hotove = await dotaz<{ lessonId: string }>(
        `SELECT "lessonId" FROM "lesson_progress" WHERE "clientId" = $1`,
        [klient.id],
      );
      expect(hotove.map((radek) => radek.lessonId)).not.toContain(poDnech);

      // Zaplaceno před čtyřmi dny a datum v minulosti → obě otevřené.
      await dotaz(`UPDATE "orders" SET "paidAt" = now() - interval '4 days' WHERE "id" = $1`, [
        objednavka,
      ]);
      await dotaz(
        `UPDATE "course_lessons" SET "unlockOn" = now() - interval '1 day' WHERE "id" = $1`,
        [odData],
      );
      // Po Hotovo stránka sama obnoví data — holé `goto()` by se s tím srazilo.
      await otevriAzUvidis(
        page,
        `/ucet/lekce/${poDnech}`,
        page.getByRole("heading", { name: "Po třech dnech" }),
      );
      await otevriAzUvidis(
        page,
        `/ucet/lekce/${odData}`,
        page.getByRole("heading", { name: "Od data" }),
      );
      await page.context().close();
    },
  );

  test(
    "po dokončení předchozí: Hotovo otevře další lekci",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Klient Navazuje ${pripona()}`);
      const produkt = await zalozProdukt(`E2E Kurz navazuje ${pripona()}`);
      const kurzId = await zalozKurz(produkt, `Navazující ${pripona()}`, [
        "První krok",
        "Druhý krok",
      ]);
      await zaplatProdukt(klient.id, produkt);
      const [prvni, druha] = await lekceKurzu(kurzId);
      await dotaz(`UPDATE "course_lessons" SET "unlockAfterPrevious" = true WHERE "id" = $1`, [
        druha,
      ]);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await page.goto(`/ucet/lekce/${prvni}`);
      await expect(
        page.getByText("Další lekce: Otevře se po dokončení lekce První krok."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Další lekce" })).toHaveCount(0);

      await page.getByRole("button", { name: "Označit jako hotovou" }).click();
      await page.getByRole("link", { name: "Další lekce" }).click();
      await expect(page.getByRole("heading", { name: "Druhý krok" })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/ucet/lekce/${druha}$`));
      await page.context().close();
    },
  );
});

test.describe("postupné odemykání v CRM", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("administrátor nastaví pravidlo ve formuláři lekce", async ({ page }) => {
    const kurzId = await zalozKurz(
      await zalozProdukt(`E2E Kurz pravidlo ${pripona()}`),
      `Pravidlo ${pripona()}`,
      ["Úvodní", "Navazující"],
    );
    await otevriAzUvidis(
      page,
      `/vzdelavani/kurzy/${kurzId}`,
      page.getByText("Navazující", { exact: true }),
    );
    await page.getByRole("button", { name: "Upravit lekci: Navazující" }).click();
    const okno = page.getByRole("dialog", { name: "Upravit lekci" });
    await okno.getByLabel("Dní po zakoupení kurzu").fill("7");
    await okno.getByLabel("Až po dokončení předchozí lekce").check();
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Lekce je uložená: Navazující.");
    await expect(
      page.getByText("Otevře se 7 dní po zakoupení, po dokončení předchozí lekce"),
    ).toBeVisible();

    // Po opětovném otevření formulář pravidlo drží; smazání dní ho zruší.
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Upravit lekci: Navazující" }).click();
    await expect(okno.getByLabel("Dní po zakoupení kurzu")).toHaveValue("7");
    await okno.getByLabel("Dní po zakoupení kurzu").fill("");
    await okno.getByLabel("Až po dokončení předchozí lekce").uncheck();
    await okno.getByRole("button", { name: "Uložit" }).click();
    await cekejNaUspech(page, "Lekce je uložená: Navazující.");
    await expect(page.getByText(/^Otevře se/)).toHaveCount(0);
  });
});

test.describe("postupné odemykání — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("pravidlo vidí, měnit nemůže", async ({ page }) => {
    const kurzId = await zalozKurz(
      await zalozProdukt(`E2E Kurz vidí ${pripona()}`),
      `Vidí ${pripona()}`,
      ["Jediná"],
    );
    const [lekce] = await lekceKurzu(kurzId);
    await dotaz(`UPDATE "course_lessons" SET "unlockAfterDays" = 14 WHERE "id" = $1`, [lekce]);
    await otevriAzUvidis(
      page,
      `/vzdelavani/kurzy/${kurzId}`,
      page.getByText("Jediná", { exact: true }),
    );
    await expect(page.getByText("Otevře se 14 dní po zakoupení")).toBeVisible();
    await expect(page.getByRole("button", { name: /Upravit lekci/ })).toHaveCount(0);
  });
});

/**
 * Body, úrovně a pořadí (Fáze 5C, Jakub 18. 10. 2026): lekce 10, kvíz 20,
 * webinář 30, aktivní týden 5, certifikát 50. Pořadí bez jmen ostatních.
 */
async function klientSHotovymiLekcemi(jmeno: string, lekci: number) {
  const klient = await zalozKlientaSUctem(jmeno);
  const produkt = await zalozProdukt(`E2E Kurz body ${pripona()}`);
  const kurzId = await zalozKurz(
    produkt,
    `Body ${pripona()}`,
    Array.from({ length: lekci }, (_, i) => `Bodová lekce ${i + 1}`),
  );
  await zaplatProdukt(klient.id, produkt);
  for (const lekceId of await lekceKurzu(kurzId)) {
    await dotaz(
      `INSERT INTO "lesson_progress" ("id", "clientId", "lessonId") VALUES (gen_random_uuid()::text, $1, $2)`,
      [klient.id, lekceId],
    );
  }
  return klient;
}

test.describe("body a úrovně v klientské části", () => {
  test(
    "body za lekce a týden, úroveň Student, pořadí bez jmen",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await klientSHotovymiLekcemi(`Klient Body ${pripona()}`, 10);
      // Jiný klient s víc body — jeho jméno se klientovi nesmí nikde ukázat.
      const soused = await klientSHotovymiLekcemi(`Soused Body ${pripona()}`, 12);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      // První návštěva zapíše aktivní týden (5 bodů); po načtení je započtený.
      await expect
        .poll(
          async () => {
            await page.goto("/ucet");
            return page.locator("[data-slot=card]", { hasText: "Vaše body" }).textContent();
          },
          { timeout: 30_000 },
        )
        .toContain("105");
      await expect(page.getByText(/Úroveň Student · pořadí \d+\. z \d+/)).toBeVisible();
      await expect(page.getByText("Do úrovně Pokročilý zbývá 195 bodů.")).toBeVisible();
      expect(await page.content()).not.toContain(soused.email);
      expect(await page.content()).not.toContain("Soused Body");
      await bezVodorovnehoPosuvu(page);
      await page.context().close();
    },
  );
});

test.describe("body a úrovně v CRM", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test("tým vidí body a úroveň na kartě klienta", async ({ page }) => {
    const klient = await klientSHotovymiLekcemi(`Klient Karta Body ${pripona()}`, 3);
    await page.goto(`/klienti/${klient.id}`);
    await expect(page.getByText("30 · Začátečník")).toBeVisible();
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
  test("člen čte zveřejněný článek, koncept nevidí", { tag: "@telefon" }, async ({ browser }) => {
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

  test(
    "bez platného členství vysvětlení a článek 404",
    { tag: "@telefon" },
    async ({ browser }) => {
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
      await expect(
        page.getByText("Členská sekce je pro klienty s platným členstvím."),
      ).toBeVisible();
      await expect(page.getByText(clanek)).toHaveCount(0);

      const odpoved = await page.goto(`/ucet/clenska-sekce/${radek!.id}`);
      expect(odpoved?.status()).toBe(404);
      await page.context().close();
    },
  );
});

/** Webinář přímo v databázi. `zaHodin` záporné = už proběhl. */
async function zalozWebinar(
  nazev: string,
  publikum: "VSICHNI" | "CLENOVE" | "KURZ",
  courseId: string | null = null,
  zaHodin = 48,
) {
  // Bez připomínky (5C): webinář „pro všechny“ by plánovač z jiného testu
  // rozeslal všem klientům v testovací databázi a rozbil jim počty e-mailů.
  const [webinar] = await dotaz<{ id: string }>(
    `INSERT INTO "webinars" ("id", "title", "startsAt", "durationMinutes", "joinUrl", "audience",
                             "courseId", "updatedAt", "remindersEnabled")
     VALUES ($1, $2, now() + make_interval(hours => $3), 60, 'https://example.com/webinar',
             $4::"WebinarAudience", $5, now(), false)
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
    // Kurzor po kliknutí zůstává nad hláškou a ta pak odpočet pozastaví
    // (sonner), takže by nezmizela nikdy — nejdřív ho odsunout stranou.
    await page.mouse.move(0, 0);
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
  test(
    "vidí jen webináře pro sebe: všichni, členové, kupci kurzu",
    { tag: "@telefon" },
    async ({ browser }) => {
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
    },
  );
});

test.describe("odznaky a karta klienta", () => {
  test(
    "lekce dají odznaky, aktivita 4 týdny taky; tým je vidí na kartě",
    { tag: "@telefon" },
    async ({ browser }) => {
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
      // Na pomalém stroji (iPhone na GitHubu) klik může přijít dřív, než
      // stránka ožije — opakuje se, dokud se lekce neotevře (18. 10. 2026).
      await expect(async () => {
        await page.getByRole("link", { name: "Začít první lekcí" }).click();
        await expect(page.getByRole("heading", { name: "Jedna" })).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
      await page.getByRole("button", { name: "Označit jako hotovou" }).click();
      await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();
      await expect(async () => {
        await page.getByRole("link", { name: "Další lekce" }).click();
        await expect(page.getByRole("heading", { name: "Dvě" })).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
      await page.getByRole("button", { name: "Označit jako hotovou" }).click();
      await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();

      // Poslední lekce nemá Další, ale Domů — zpátky na přehled s odznaky
      // (Jakub, 5. 10. 2026).
      await expect(page.getByRole("link", { name: "Další lekce" })).toHaveCount(0);
      await page.getByRole("link", { name: "Domů" }).click();
      await expect(page).toHaveURL(/\/ucet$/);
      // Medaile jsou vidět všechny (varianta B, 10. 10. 2026) — získané
      // poznáme podle `data-ziskany`.
      const odznaky = page.getByRole("list", { name: "Odznaky" });
      for (const odznak of ["První krok", "V půlce", "Kurz dokončen", "Vytrvalost"]) {
        await expect(odznaky.getByRole("listitem").filter({ hasText: odznak })).toHaveAttribute(
          "data-ziskany",
          "ano",
        );
      }
      await expect(
        odznaky.getByRole("listitem").filter({ hasText: "Pravidelný host" }),
      ).toHaveAttribute("data-ziskany", "ne");
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
    },
  );
});
