import { expect, test } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
import {
  prihlasKlienta,
  prohlizecKlienta,
  zalozKlientaSUctem,
  zalozKurz,
  zalozProdukt,
  zaplatProdukt,
} from "./pomocne-klient";

/**
 * Dotazy u lekcí (Fáze 5C, Jakub 18. 10. 2026).
 *
 * - Klient se zeptá u lekce svého kurzu; dotaz vidí jen on a tým — jiný
 *   klient se stejným kurzem ne, cizí lekce ani přímým voláním.
 * - Nezodpovězený dotaz jde stáhnout (s potvrzením), zodpovězený ne.
 * - Odpovídá každý přihlášený, klient dostane upozornění; mazat jen admin.
 */

const MAILPIT = "http://mailpit:8025";

async function kurzSLekci(nazev: string) {
  const produkt = await zalozProdukt(`E2E Kurz dotazy ${pripona()}`);
  const kurzId = await zalozKurz(produkt, nazev, ["Lekce s dotazem"]);
  const [lekce] = await dotaz<{ id: string }>(
    `SELECT "id" FROM "course_lessons" WHERE "courseId" = $1`,
    [kurzId],
  );
  return { produkt, kurzId, lekceId: lekce!.id };
}

async function polozDotaz(text: string) {
  const klient = await zalozKlientaSUctem(`Dotaz Klient ${pripona()}`);
  const kurz = await kurzSLekci(`Dotazový ${pripona()}`);
  await zaplatProdukt(klient.id, kurz.produkt);
  const [radek] = await dotaz<{ id: string }>(
    `INSERT INTO "lesson_questions" ("id", "lessonId", "clientId", "text")
     VALUES (gen_random_uuid()::text, $1, $2, $3) RETURNING "id"`,
    [kurz.lekceId, klient.id, text],
  );
  return { klient, ...kurz, dotazId: radek!.id };
}

test.describe("dotazy u lekcí — klient", () => {
  test(
    "zeptá se, jiný klient dotaz nevidí, nezodpovězený stáhne",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Ptá se ${pripona()}`);
      const soused = await zalozKlientaSUctem(`Soused dotaz ${pripona()}`);
      const kurz = await kurzSLekci(`Ptací ${pripona()}`);
      await zaplatProdukt(klient.id, kurz.produkt);
      await zaplatProdukt(soused.id, kurz.produkt);
      const text = `Jak se počítá výnos? ${pripona()}`;

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await otevriAzUvidis(
        page,
        `/ucet/lekce/${kurz.lekceId}`,
        page.getByLabel("Máte k lekci dotaz?"),
      );
      await page.getByLabel("Máte k lekci dotaz?").fill(text);
      await page.getByRole("button", { name: "Odeslat dotaz" }).click();
      const moje = page.getByRole("list", { name: "Moje dotazy" });
      await expect(moje.getByText(text)).toBeVisible();
      await expect(moje.getByText("Čeká na odpověď.")).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Soused se stejným kurzem dotaz nevidí.
      const druha = await prohlizecKlienta(browser);
      await prihlasKlienta(druha, soused.email, soused.heslo);
      await druha.goto(`/ucet/lekce/${kurz.lekceId}`);
      await expect(druha.getByLabel("Máte k lekci dotaz?")).toBeVisible();
      expect(await druha.content()).not.toContain(text);
      await druha.context().close();

      // Stáhnout s potvrzením.
      await moje.getByRole("button", { name: "Smazat" }).click();
      const okno = page.getByRole("dialog", { name: "Stáhnout dotaz" });
      await expect(okno.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
      await okno.getByRole("button", { name: "Smazat" }).click();
      await expect(page.getByText(text)).toHaveCount(0);
      await page.context().close();
    },
  );

  test(
    "u cizí lekce se zeptat nejde ani přímým voláním",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Podvrh dotaz ${pripona()}`);
      const vlastni = await kurzSLekci(`Vlastní dotaz ${pripona()}`);
      await zaplatProdukt(klient.id, vlastni.produkt);
      const cizi = await kurzSLekci(`Cizí dotaz ${pripona()}`);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);
      await otevriAzUvidis(
        page,
        `/ucet/lekce/${vlastni.lekceId}`,
        page.getByLabel("Máte k lekci dotaz?"),
      );
      await page.getByLabel("Máte k lekci dotaz?").fill("Zkušební dotaz");
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        page.getByRole("button", { name: "Odeslat dotaz" }).click(),
      ]);
      const telo = akce.postData() ?? "";
      expect(telo).toContain(vlastni.lekceId);
      await page.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        data: telo.replace(vlastni.lekceId, cizi.lekceId),
      });
      const uCizi = await dotaz(`SELECT 1 FROM "lesson_questions" WHERE "lessonId" = $1`, [
        cizi.lekceId,
      ]);
      expect(uCizi).toHaveLength(0);
      await page.context().close();
    },
  );
});

test.describe("dotazy u lekcí — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "odpoví, klient odpověď vidí a dostane e-mail; smazat nemůže",
    { tag: "@telefon" },
    async ({ page, browser }) => {
      const text = `Co je to dividenda? ${pripona()}`;
      const d = await polozDotaz(text);

      await otevriAzUvidis(page, "/vzdelavani/dotazy", page.getByText(text));
      const polozka = page.getByRole("listitem").filter({ hasText: text });
      await expect(polozka.getByRole("button", { name: /Smazat dotaz/ })).toHaveCount(0);
      await polozka.getByLabel("Odpověď klientovi").fill("Podíl na zisku firmy, viz lekce.");
      await polozka.getByRole("button", { name: "Odeslat odpověď" }).click();
      await cekejNaUspech(page, "Odpověď je odeslaná.");
      await bezVodorovnehoPosuvu(page);

      await expect
        .poll(
          async () => {
            const hledani = await fetch(
              `${MAILPIT}/api/v1/search?query=${encodeURIComponent(
                `to:"${d.klient.email}" subject:"Odpověděli jsme na váš dotaz"`,
              )}`,
            );
            return ((await hledani.json()) as { messages: unknown[] }).messages.length;
          },
          { timeout: 20_000 },
        )
        .toBe(1);

      const klientska = await prohlizecKlienta(browser);
      await prihlasKlienta(klientska, d.klient.email, d.klient.heslo);
      await klientska.goto(`/ucet/lekce/${d.lekceId}`);
      const moje = klientska.getByRole("list", { name: "Moje dotazy" });
      await expect(moje.getByText("Podíl na zisku firmy, viz lekce.")).toBeVisible();
      // Zodpovězený dotaz už stáhnout nejde.
      await expect(moje.getByRole("button", { name: "Smazat" })).toHaveCount(0);
      await klientska.context().close();
    },
  );
});

test.describe("dotazy u lekcí — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test("smaže dotaz s potvrzením", async ({ page }) => {
    const text = `Spam ${pripona()}`;
    await polozDotaz(text);
    await otevriAzUvidis(page, "/vzdelavani/dotazy", page.getByText(text));
    const polozka = page.getByRole("listitem").filter({ hasText: text });
    await polozka.getByRole("button", { name: /Smazat dotaz/ }).click();
    const okno = page.getByRole("dialog", { name: "Smazat dotaz" });
    await okno.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, "Smazáno: dotaz.");
    await expect(page.getByText(text)).toHaveCount(0);
  });
});
