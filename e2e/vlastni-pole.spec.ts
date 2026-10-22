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
import { zalozKlientaSUctem } from "./pomocne-klient";

/**
 * Vlastní pole u klienta (Fáze 5B, Jakub 18. 10. 2026).
 *
 * - Seznam polí spravuje jen administrátor (Nastavení → Vlastní pole);
 *   uživatel tam dostane 404 a akci nezavolá.
 * - Hodnoty vyplní každý přihlášený na kartě klienta; neplatná se odmítne.
 * - Filtr seznamu klientů podle výběru; smazané pole zmizí z karty.
 */

async function zalozPole(nazev: string, druh: string, moznosti: string[] = []) {
  const [pole] = await dotaz<{ id: string }>(
    `INSERT INTO "client_fields" ("id", "name", "kind", "options", "position", "updatedAt")
     VALUES ($1, $2, $3::"ClientFieldKind", $4, 1000, now()) RETURNING "id"`,
    [`e2epole${pripona()}${pripona()}`, nazev, druh, moznosti],
  );
  return pole!.id;
}

test.describe("vlastní pole — administrátor", () => {
  test.use({ storageState: stavPrihlaseni("admin") });

  test(
    "založí pole s výběrem, jedna možnost nestačí, smaže ho",
    { tag: "@telefon" },
    async ({ page, browser }) => {
      const nazev = `Zkušenost ${pripona()}`;
      await page.goto("/nastaveni/pole");
      await page.getByRole("button", { name: "Nové pole" }).click();
      const okno = page.getByRole("dialog", { name: "Nové pole" });
      await okno.getByLabel("Název").fill(nazev);
      await vyber(page, "Druh", "Výběr z možností");
      await okno.getByLabel(/Možnosti/).fill("jen jedna");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await expect(okno.getByText("Výběr potřebuje aspoň dvě možnosti")).toBeVisible();

      await okno.getByLabel(/Možnosti/).fill("začátečník\npokročilý\nprofesionál");
      const [akce] = await Promise.all([
        page.waitForRequest((pozadavek) => !!pozadavek.headers()["next-action"]),
        okno.getByRole("button", { name: "Uložit" }).click(),
      ]);
      await cekejNaUspech(page, `Pole je založené: ${nazev}.`);

      // Stejné volání od uživatele (jiný název) pole nezaloží.
      const zkusil = `Podvrh ${pripona()}`;
      const telo = akce.postDataBuffer()!.toString("utf8");
      expect(telo).toContain(nazev);
      const uzivatel = await browser.newContext({ storageState: stavPrihlaseni("uzivatel") });
      await uzivatel.request.post(akce.url(), {
        headers: {
          "Next-Action": akce.headers()["next-action"]!,
          "Content-Type": akce.headers()["content-type"]!,
          Accept: "text/x-component",
        },
        data: Buffer.from(telo.replace(nazev, zkusil), "utf8"),
      });
      await uzivatel.close();
      const podvrh = await dotaz(`SELECT 1 FROM "client_fields" WHERE "name" = $1`, [zkusil]);
      expect(podvrh, "uživatel nesmí pole založit").toHaveLength(0);
      const radek = page
        .getByRole("list", { name: "Vlastní pole" })
        .getByRole("listitem")
        .filter({ has: page.getByText(nazev, { exact: true }) });
      await expect(radek).toContainText("začátečník, pokročilý, profesionál");
      await bezVodorovnehoPosuvu(page);

      await radek.getByRole("button", { name: `Smazat pole` }).click();
      const potvrzeni = page.getByRole("dialog", { name: "Smazat pole" });
      await expect(potvrzeni.getByText(nazev)).toBeVisible();
      await potvrzeni.getByRole("button", { name: "Smazat" }).click();
      await cekejNaUspech(page, `Smazáno: ${nazev}.`);
      await expect(page.getByText(nazev, { exact: true })).toHaveCount(0);
    },
  );
});

test.describe("vlastní pole — uživatel", () => {
  test.use({ storageState: stavPrihlaseni("uzivatel") });

  test(
    "Nastavení nevidí ani nezavolá; hodnoty vyplní a filtruje",
    { tag: "@telefon" },
    async ({ page }) => {
      expect((await page.goto("/nastaveni/pole"))?.status()).toBe(404);

      const p = pripona();
      const vyberId = await zalozPole(`Úroveň ${p}`, "VYBER", ["nová", "zkušená"]);
      await zalozPole(`Kapitál ${p}`, "CISLO");
      const klient = await zalozKlientaSUctem(`Pole Klient ${p}`);
      const jiny = await zalozKlientaSUctem(`Pole Jiný ${p}`);

      await otevriAzUvidis(
        page,
        `/klienti/${klient.id}`,
        page.getByRole("button", { name: "Vyplnit pole" }),
      );
      await page.getByRole("button", { name: "Vyplnit pole" }).click();
      const okno = page.getByRole("dialog", { name: "Vlastní pole" });
      await vyber(page, `Úroveň ${p}`, "zkušená");
      await okno.getByLabel(`Kapitál ${p}`).fill("dvacet");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await expect(okno.getByText(`Kapitál ${p}: napiš číslo.`)).toBeVisible();

      await okno.getByLabel(`Kapitál ${p}`).fill("1 234,5");
      await okno.getByRole("button", { name: "Uložit" }).click();
      await cekejNaUspech(page, /^Uloženo: /);
      const pole = page.getByRole("region", { name: "Vlastní pole" });
      await expect(pole.getByText("zkušená", { exact: true })).toBeVisible();
      await expect(pole.getByText(/^1\s234,5$/)).toBeVisible();
      await bezVodorovnehoPosuvu(page);

      // Filtr podle výběru najde jen vyplněného klienta.
      await page.goto(
        `/klienti?hledat=${encodeURIComponent(p)}&pole=${encodeURIComponent(`${vyberId}:zkušená`)}`,
      );
      await expect(page.getByRole("link", { name: klient.name, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: jiny.name, exact: true })).toHaveCount(0);

      // Smazané pole zmizí z karty.
      await dotaz(`UPDATE "client_fields" SET "deletedAt" = now() WHERE "id" = $1`, [vyberId]);
      await page.goto(`/klienti/${klient.id}`);
      await expect(page.getByText(`Úroveň ${p}`)).toHaveCount(0);
    },
  );
});
