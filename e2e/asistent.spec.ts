import { expect, test, type Page } from "@playwright/test";

import { bezVodorovnehoPosuvu, dotaz, pripona, prihlas, zalozUzivatele } from "./pomocne";

/**
 * Asistent AI v CRM (krok 4, Jakub 10. 10. 2026).
 *
 * - **jen administrátor** (že uživatel menu ani adresu nemá, hlídá
 *   `opravneni.spec.ts`),
 * - klienti jdou k AI **jen pod přezdívkou** — jméno, e-mail ani telefon
 *   v požadavku k Anthropicu nejsou, ani když je člověk napíše do otázky,
 * - jen čtení: asistent nemá zápis, poznámky, hovory ani nic o týmu,
 * - Sonnet 5.5 s pojistkou `fallbacks: "default"`,
 * - limit 20 otázek denně, do Aktivity jen použité nástroje.
 *
 * Aplikace v testech mluví s napodobeninou Anthropicu
 * (`e2e/napodobenina-anthropic.mjs`) — ven nic neodchází.
 */

const NAPODOBENINA = "http://localhost:3199";

interface Zaznam {
  hlavicky: { beta: string };
  telo: { model: string; fallbacks: unknown; tools: { name: string }[] };
}

async function zaznamy(znacka: string): Promise<Zaznam[]> {
  const odpoved = await fetch(`${NAPODOBENINA}/zaznamy?obsahuje=${encodeURIComponent(znacka)}`);
  return (await odpoved.json()) as Zaznam[];
}

async function prihlasAdmina(page: Page) {
  const admin = await zalozUzivatele("admin", "Asistent");
  await prihlas(page, admin.email, admin.heslo);
  await expect(page).toHaveURL(/\/dashboard/);
  return admin;
}

async function zeptejSe(page: Page, otazka: string) {
  await page.getByLabel("Tvoje otázka").fill(otazka);
  await page.getByRole("button", { name: "Zeptat se" }).click();
}

test.describe("asistent AI", () => {
  test(
    "klient jde k AI jen pod přezdívkou; v CRM se ukáže jménem",
    { tag: "@telefon" },
    async ({ page }) => {
      const admin = await prihlasAdmina(page);
      const jmeno = `Zuzana Asistentová ${pripona()}`;
      const email = `asistent-${pripona()}@example.test`;
      const [klient] = await dotaz<{ id: string }>(
        `INSERT INTO "clients" ("id", "name", "email", "phone", "sourceId", "updatedAt")
       VALUES ($1, $2, $3, '+420 601 234 567', 'landing-page', now())
       RETURNING "id"`,
        [`e2e${pripona()}${pripona()}`, jmeno, email],
      );

      await page.goto("/asistent");
      await expect(page.getByText("Dnes zbývá 20 z 20 otázek.")).toBeVisible();

      // Jméno bez diakritiky a malými písmeny, k tomu e-mail a telefon.
      const znacka = `znacka${pripona()}`;
      await zeptejSe(
        page,
        `Co víš o ${jmeno.toLowerCase().replace("á", "a")} (${email}, 601 234 567)? ` +
          `[nastroj:hledat_klienty {"hledat":"${jmeno}"}] [retez] ${znacka}`,
      );

      // Odpověď: přezdívka se v okně změnila na jméno s odkazem na kartu.
      const odpoved = page.locator('[data-role="assistant"]');
      await expect(odpoved).toContainText("Našla jsem:");
      await expect(odpoved.getByRole("link", { name: jmeno })).toHaveAttribute(
        "href",
        `/klienti/${klient!.id}`,
      );
      await expect(page.getByText("Dnes zbývá 19 z 20 otázek.")).toBeVisible();

      // Co by odešlo k Anthropicu: bez jména, e-mailu i telefonu.
      const poslane = await zaznamy(znacka);
      expect(poslane.length, "otázka, dva nástroje = tři požadavky").toBe(3);
      const vse = JSON.stringify(poslane);
      expect(vse).not.toContain(jmeno);
      expect(vse.toLowerCase()).not.toContain("asistentova");
      expect(vse).not.toContain(email);
      expect(vse).not.toMatch(/601 ?234 ?567/);
      expect(vse).toMatch(/K-[A-Z2-7]{6}/);

      // Model, pojistka při odmítnutí, jen nástroje ke čtení bez volného textu.
      const prvni = poslane[0]!;
      expect(prvni.telo.model).toBe("claude-sonnet-5-5");
      expect(prvni.telo.fallbacks).toBe("default");
      expect(prvni.hlavicky.beta).toContain("server-side-fallback-2026-07-01");
      const nastroje = prvni.telo.tools.map((nastroj) => nastroj.name);
      expect(nastroje).toContain("hledat_klienty");
      for (const zakazany of [
        "pridat_poznamku",
        "zalozit_ukol",
        "poznamky_klienta",
        "hovory_klienta",
        "moje_ukoly",
        "auditni_log",
        "prihlaseni_tymu",
        "tym",
        "chyby",
      ]) {
        expect(nastroje, `asistent nemá mít ${zakazany}`).not.toContain(zakazany);
      }

      // Aktivita: jen použité nástroje, nic z otázky.
      const [udalost] = await dotaz<{ detail: string }>(
        `SELECT "detail" FROM "user_events" WHERE "userId" = $1 AND "kind" = 'ASISTENT'`,
        [admin.id],
      );
      expect(udalost!.detail).toBe("hledat_klienty, detail_klienta");

      // Nový rozhovor okno vyčistí.
      await page.getByRole("button", { name: "Nový rozhovor" }).click();
      await expect(odpoved).toHaveCount(0);
      await bezVodorovnehoPosuvu(page);
    },
  );

  test("chyba a odmítnutí: srozumitelná hláška, otázka zůstane v poli", async ({ page }) => {
    await prihlasAdmina(page);
    await page.goto("/asistent");

    await zeptejSe(page, `Kolik je objednávek? [chyba-401] ${pripona()}`);
    await expect(page.getByText("Klíč k Anthropicu nefunguje.")).toBeVisible();
    await expect(page.getByLabel("Tvoje otázka")).toHaveValue(/\[chyba-401\]/);

    await zeptejSe(page, `Poraď mi [odmitni] ${pripona()}`);
    await expect(page.getByText("Na tohle asistent neodpoví.")).toBeVisible();
  });

  test("po 20 otázkách za den je konec", async ({ page }) => {
    const admin = await prihlasAdmina(page);
    await dotaz(
      `INSERT INTO "user_events" ("id", "userId", "kind", "detail")
       SELECT gen_random_uuid()::text, $1, 'ASISTENT', 'otázka' FROM generate_series(1, 20)`,
      [admin.id],
    );
    await page.goto("/asistent");
    await expect(page.getByText("Dnešní limit 20 otázek je vyčerpaný. Zítra zase.")).toBeVisible();
    await expect(page.getByLabel("Tvoje otázka")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Zeptat se" })).toBeDisabled();
  });
});
