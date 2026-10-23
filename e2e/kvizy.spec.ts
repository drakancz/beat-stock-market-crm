import { expect, test, type Page } from "@playwright/test";

import {
  bezVodorovnehoPosuvu,
  cekejNaUspech,
  dotaz,
  otevriAzUvidis,
  pripona,
  stavPrihlaseni,
} from "./pomocne";
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
 * Kvízy u lekcí a certifikát o absolvování kurzu (Fáze 5C, Jakub 11. 10. 2026).
 *
 * - **Kvíz zakládá a mění jen administrátor** — uživatel ho vidí jen ke
 *   čtení a neuloží ho ani přímým voláním serverové akce.
 * - Klient: aspoň 80 % ke splnění, pokusů neomezeně, **správné odpovědi
 *   do prohlížeče nejdou**.
 * - Certifikát po všech lekcích a všech kvízech; PDF stáhne jen sám klient.
 * - Výsledky a certifikát vidí na kartě klienta každý přihlášený.
 */

/** Kvíz přímo v databázi: u každé otázky je správná první možnost. */
async function zalozKviz(lessonId: string, otazek: number) {
  const otazky = Array.from({ length: otazek }, (_, i) => ({
    otazka: `Otázka číslo ${i + 1}?`,
    moznosti: [`Správně ${i + 1}`, `Špatně ${i + 1}`],
    spravna: 0,
  }));
  await dotaz(
    `INSERT INTO "lesson_quizzes" ("id", "lessonId", "questions", "updatedAt")
     VALUES ($1, $2, $3::jsonb, now())`,
    [`e2ekviz${pripona()}${pripona()}`, lessonId, JSON.stringify(otazky)],
  );
}

/** Odpoví na kvíz: prvních `spravne` otázek správně, zbytek špatně. */
async function odpovez(page: Page, otazek: number, spravne: number) {
  for (let i = 1; i <= otazek; i++) {
    await page.getByRole("radio", { name: `${i <= spravne ? "Správně" : "Špatně"} ${i}` }).check();
  }
  await page.getByRole("button", { name: "Vyhodnotit" }).click();
}

test.describe("kvíz očima administrátora a uživatele", () => {
  test("administrátor kvíz založí a smaže, uživatel ho ani přímo neuloží", async ({ browser }) => {
    const nazev = `Kurz s kvízem ${pripona()}`;
    const kurzId = await zalozKurz(await zalozProdukt(`E2E Kvíz ${pripona()}`), nazev, [
      "Úvodní lekce",
    ]);
    const [lekceId] = await lekceKurzu(kurzId);

    const admin = await browser.newContext({ storageState: stavPrihlaseni("admin") });
    const page = await admin.newPage();
    await page.goto(`/vzdelavani/kurzy/${kurzId}`);
    await page.getByRole("button", { name: "Přidat kvíz: Úvodní lekce" }).click();
    const okno = page.getByRole("dialog", { name: "Přidat kvíz: Úvodní lekce" });
    await okno.getByLabel("Otázka 1", { exact: true }).fill("Co je ETF?");
    await okno.getByLabel("Otázka 1, možnost 1").fill("Fond obchodovaný na burze");
    await okno.getByLabel("Otázka 1, možnost 2").fill("Druh dluhopisu");
    await okno.getByRole("button", { name: "Přidat otázku" }).click();
    await okno.getByLabel("Otázka 2", { exact: true }).fill("Co znamená diverzifikace?");
    await okno.getByLabel("Otázka 2, možnost 1").fill("Rozložení do více investic");
    await okno.getByLabel("Otázka 2, možnost 2").fill("Jedna velká investice");
    await okno.getByLabel("Správná odpověď u otázky 1: možnost 1").check();

    // Bez označené správné odpovědi server kvíz odmítne a okno zůstane.
    await okno.getByRole("button", { name: "Uložit kvíz" }).click();
    await expect(okno.getByText("U každé otázky vyber správnou odpověď.")).toBeVisible();

    await okno.getByLabel("Správná odpověď u otázky 2: možnost 1").check();
    // Zachytí se volání serverové akce — uživatel ho pak zkusí zopakovat.
    const [akce] = await Promise.all([
      page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
      okno.getByRole("button", { name: "Uložit kvíz" }).click(),
    ]);
    await cekejNaUspech(page, "Kvíz je uložený: Úvodní lekce.");
    await expect(page.getByText("Kvíz · 2 otázky")).toBeVisible();

    await page.getByRole("button", { name: "Smazat kvíz: kvíz u lekce Úvodní lekce" }).click();
    const potvrzeni = page.getByRole("dialog", { name: "Smazat kvíz" });
    await expect(potvrzeni.getByText("Tuhle akci nelze vzít zpět.")).toBeVisible();
    await potvrzeni.getByRole("button", { name: "Smazat" }).click();
    await cekejNaUspech(page, "Kvíz je smazaný: Úvodní lekce.");
    await expect(page.getByText("Kvíz · 2 otázky")).toHaveCount(0);
    await admin.close();

    // Uživatel zopakuje přesně totéž volání akce — server ho odmítne
    // (`requireAdmin()`), skrytým tlačítkem to nekončí.
    const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
    await tym.request.post(akce.url(), {
      headers: {
        "Next-Action": akce.headers()["next-action"]!,
        "Content-Type": akce.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      data: akce.postData() ?? "",
    });
    const [kviz] = await dotaz<{ smazany: boolean }>(
      `SELECT "deletedAt" IS NOT NULL AS "smazany" FROM "lesson_quizzes" WHERE "lessonId" = $1`,
      [lekceId],
    );
    expect(kviz?.smazany, "uživatel nesmí kvíz uložit ani přímým voláním").toBe(true);
    await tym.close();
  });
});

test.describe("kvíz a certifikát v klientské části", () => {
  test(
    "klient kvíz napoprvé nesplní, napodruhé ano, dostane certifikát a PDF",
    { tag: "@telefon" },
    async ({ browser }) => {
      const klient = await zalozKlientaSUctem(`Klient Kvíz ${pripona()}`);
      const produkt = await zalozProdukt(`E2E Kurz certifikát ${pripona()}`);
      const nazev = `Certifikovaný kurz ${pripona()}`;
      const kurzId = await zalozKurz(produkt, nazev, ["Lekce jedna", "Lekce dvě"]);
      const [prvni, druha] = await lekceKurzu(kurzId);
      await zalozKviz(druha!, 5);
      await zaplatProdukt(klient.id, produkt);

      const page = await prohlizecKlienta(browser);
      await prihlasKlienta(page, klient.email, klient.heslo);

      await page.goto(`/ucet/kurzy/${kurzId}`);
      await expect(page.getByText(/Certifikát dostanete/)).toContainText("Zbývají 2 lekce.");
      await expect(page.getByText(/Certifikát dostanete/)).toContainText(
        "Nesplněné kvízy u lekcí: Lekce dvě.",
      );

      await page.goto(`/ucet/lekce/${druha}`);
      await expect(page.getByRole("heading", { name: "Kvíz k lekci" })).toBeVisible();
      // Správné odpovědi se do stránky vůbec nedostanou.
      expect(await page.content()).not.toContain("spravna");
      await bezVodorovnehoPosuvu(page);

      // 3 z 5 = 60 % — nestačí.
      await odpovez(page, 5, 3);
      await expect(page.getByText(/Tentokrát to nestačilo: 3 z 5 správně/)).toBeVisible();
      await expect(page.getByText("Tahle odpověď nebyla správná.")).toHaveCount(2);
      await page.getByRole("button", { name: "Zkusit znovu" }).click();

      await odpovez(page, 5, 5);
      await expect(page.getByText(/Kvíz je splněný: 5 z 5 správně/)).toBeVisible();
      await expect(page.getByText("Splněno 5/5")).toBeVisible();
      await page.getByRole("button", { name: "Označit jako hotovou" }).click();
      await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();

      // Poslední chybějící lekce vydá certifikát.
      await page.goto(`/ucet/lekce/${prvni}`);
      await page.getByRole("button", { name: "Označit jako hotovou" }).click();
      await expect(page.getByRole("button", { name: "Hotovo — vrátit" })).toBeVisible();

      await page.goto(`/ucet/kurzy/${kurzId}`);
      await expect(page.getByText("Certifikát o absolvování kurzu")).toBeVisible();
      await expect(page.getByText(/CERT-\d{4}-\d{4}/)).toBeVisible();
      await expect(page.getByText("kvíz splněný")).toBeVisible();
      const odkaz = page.getByRole("link", { name: "Stáhnout certifikát (PDF)" });
      const adresa = (await odkaz.getAttribute("href"))!;

      const pdf = await page.request.get(adresa);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect(pdf.headers()["content-disposition"]).toMatch(/certifikat-CERT-\d{4}-\d{4}\.pdf/);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      await page.goto("/ucet");
      const certifikaty = page.getByRole("list", { name: "Certifikáty" });
      await expect(certifikaty.getByText(nazev)).toBeVisible();
      await bezVodorovnehoPosuvu(page);
      await page.context().close();

      // Cizí klient certifikát nestáhne, nepřihlášený taky ne.
      const cizi = await zalozKlientaSUctem(`Klient Cizí ${pripona()}`);
      const ciziPage = await prohlizecKlienta(browser);
      await prihlasKlienta(ciziPage, cizi.email, cizi.heslo);
      expect((await ciziPage.request.get(adresa)).status()).toBe(404);
      await ciziPage.context().close();

      const anonym = await prohlizecKlienta(browser);
      const bezPrihlaseni = await anonym.request.get(adresa, { maxRedirects: 0 });
      expect(bezPrihlaseni.status()).toBe(307);
      expect(bezPrihlaseni.headers()["location"]).toContain("/ucet/prihlaseni");
      await anonym.context().close();

      // Tým vidí výsledek kvízu i certifikát na kartě, kvíz v CRM jen ke čtení.
      const tym = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      const karta = await tym.newPage();
      await karta.goto(`/klienti/${klient.id}`);
      await expect(karta.getByText("Lekce dvě 5/5 splněno (2 pokusy)")).toBeVisible();
      await expect(karta.getByText(new RegExp(`${nazev} — CERT-\\d{4}-\\d{4}`))).toBeVisible();

      await otevriAzUvidis(
        karta,
        `/vzdelavani/kurzy/${kurzId}`,
        karta.getByText("Kvíz · 5 otázek"),
      );
      await karta.getByRole("button", { name: "Kvíz: Lekce dvě" }).click();
      const okno = karta.getByRole("dialog", { name: "Kvíz: Lekce dvě" });
      await expect(okno.getByLabel("Otázka 1", { exact: true })).toHaveValue("Otázka číslo 1?");
      await expect(okno.getByRole("button", { name: "Uložit kvíz" })).toHaveCount(0);
      await tym.close();
    },
  );
});
