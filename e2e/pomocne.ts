import { randomBytes } from "node:crypto";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";

import type { Role } from "../src/generated/prisma/enums";
import { zahesluj } from "../src/lib/hesla";

import { STITEK_TELEFON, beziNaTelefonu } from "./telefon";

/**
 * Pomůcky sdílené všemi testy.
 *
 * Do databáze se sahá jen kvůli **přípravě** (zkušební účty s náhodným
 * heslem, odebrání přístupu). Samotné chování aplikace se vždy ověřuje
 * přes prohlížeč.
 *
 * **Proč `pg` a ne Prisma:** vygenerovaný klient Prismy je ES modul
 * (`import.meta`) a Playwright testy v tomhle projektu načítá jako
 * CommonJS — klient by se nenačetl. Dotazy jsou parametrizované.
 */

let spojeni: Pool | undefined;

/** Dotaz do testovací databáze (adresu přepsal playwright.config.ts). */
export async function dotaz<T extends Record<string, unknown>>(
  sql: string,
  parametry: unknown[] = [],
): Promise<T[]> {
  const adresa = process.env.DATABASE_URL ?? "";
  // `crm_test_ukazka` je databáze testů ukázky (playwright.ukazka.config.ts).
  if (!/\/crm_test(_ukazka)?(\?|$)/.test(adresa)) {
    throw new Error("Testy smí sahat jen na crm_test a crm_test_ukazka.");
  }

  spojeni ??= new Pool({ connectionString: adresa, max: 2 });
  const vysledek = await spojeni.query<T>(sql, parametry);
  return vysledek.rows;
}

/** Úprava zkušebního účtu — to, co jinak udělá administrátor ve Správě. */
export async function upravUzivatele(
  id: string,
  zmena: { active?: boolean; deletedAt?: Date; tokensValidFrom?: Date },
) {
  await dotaz(
    `UPDATE "users" SET
       "active" = COALESCE($2, "active"),
       "deletedAt" = COALESCE($3, "deletedAt"),
       "tokensValidFrom" = COALESCE($4, "tokensValidFrom"),
       "updatedAt" = now()
     WHERE "id" = $1`,
    [id, zmena.active ?? null, zmena.deletedAt ?? null, zmena.tokensValidFrom ?? null],
  );
}

/** Krátká náhodná přípona, aby si souběžné testy nepřepisovaly záznamy. */
export function pripona(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Role zkušebních účtů. Od 22. 9. 2026 jsou dvě — obchodník a manažer
 * se sloučili do „uživatele", protože se klienti nikomu nepřiřazují.
 */
export type RoleTestu = "admin" | "uzivatel";

const ROLE: Record<RoleTestu, Role> = {
  admin: "ADMINISTRATOR",
  uzivatel: "UZIVATEL",
};

export const NAZEV_ROLE: Record<RoleTestu, string> = {
  admin: "Administrátor",
  uzivatel: "Uživatel",
};

/**
 * Založí zkušební účet s náhodným heslem.
 *
 * Heslo se vrací jen testu, který si účet založil — nikam se neukládá.
 */
export async function zalozUzivatele(role: RoleTestu, jmeno = "E2E") {
  const heslo = randomBytes(18).toString("base64url");
  const email = `e2e-${role}-${pripona()}@beatstockmarket.test`;
  const prijmeni = NAZEV_ROLE[role];

  const [uzivatel] = await dotaz<{ id: string; name: string; email: string }>(
    `INSERT INTO "users"
       ("id", "name", "firstName", "lastName", "email", "role",
        "passwordHash", "passwordSetAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6::"Role", $7, now(), now())
     RETURNING "id", "name", "email"`,
    [
      `e2e${pripona()}${pripona()}`,
      `${jmeno} ${prijmeni}`,
      jmeno,
      prijmeni,
      email,
      ROLE[role],
      await zahesluj(heslo),
    ],
  );

  return { ...uzivatel, heslo };
}

/** Soubor s přihlášením dané role (vzniká v `priprava.setup.ts`). */
export function stavPrihlaseni(role: RoleTestu): string {
  return path.join(__dirname, ".stav", `${role}.json`);
}

/** Soubor s údaji o účtech z přípravy (id a jméno, bez hesla). */
export const SOUBOR_UCTU = path.join(__dirname, ".stav", "ucty.json");

/**
 * Náhodná adresa odesílatele pro přihlašování.
 *
 * Aplikace omezuje neúspěšná přihlášení podle IP adresy z hlavičky
 * `X-Forwarded-For`. Všechny testy jdou z jednoho kontejneru, takže by se
 * navzájem zablokovaly — každý dostane vlastní adresu.
 */
export function nahodnaAdresa(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${a}.${b}.${c}`;
}

/** Přihlášení formulářem. Po úspěchu čeká na Dashboard (nebo jiný cíl). */
export async function prihlas(page: Page, email: string, heslo: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": nahodnaAdresa() });
  await page.goto("/prihlaseni");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill(heslo);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
}

/** Je okno úzké jako telefon? Menu je pak schované ve vysouvacím panelu. */
export function jeMobil(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/**
 * Hlavní menu. Na telefonu ho nejdřív otevře tlačítkem v horní liště.
 */
export async function menu(page: Page) {
  if (jeMobil(page)) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const panel = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    await expect(panel).toBeVisible();
    return panel;
  }
  return page.locator('[data-slot="sidebar-inner"]');
}

/** Počká na zelené upozornění v rohu s daným textem. */
export async function cekejNaUspech(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/**
 * Počká, až upozornění v rohu zmizí. Na telefonu leží přes spodek
 * obrazovky a zakryje tlačítko, které test chce stisknout znovu.
 * Myš se odsune, protože upozornění pod ní nezmizí (sonner ho pozdrží).
 */
export async function cekejNaZmizeniUpozorneni(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Vybere hodnotu v rozbalovacím seznamu (shadcn `Select`) podle popisku.
 */
export async function vyber(page: Page, popisek: string, volba: string | RegExp) {
  await page.getByRole("combobox", { name: popisek }).click();
  await page.getByRole("option", { name: volba }).click();
}

/**
 * Otevře adresu a počká, až je na ní daný prvek.
 *
 * Používá se po uložení formuláře: dialog po úspěchu obnovuje aktuální
 * stránku (`router.refresh()`) a přechod jinam by se s tím obnovením
 * srazil („navigation is interrupted by another navigation"). Proto se
 * načítá znovu, dokud prvek opravdu není vidět.
 */
export async function otevriAzUvidis(page: Page, adresa: string, prvek: Locator) {
  await expect(async () => {
    await page.goto(adresa);
    /*
     * Čekání na prvek je dlouhé schválně (22. 9. 2026). Krátká lhůta
     * a rychlé opakování se při plné sadě zakously: každé další
     * `goto()` zruší rozdělaný překlad stránky a server začne od
     * začátku, takže se obrazovka nikdy nestihla dopočítat. Takhle
     * spadla příloha na profilu kolegy ve všech třech prohlížečích,
     * přestože sama o sobě projde. Radši počkat dýl než překlad utínat.
     */
    await expect(prvek).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 90_000 });
}

/**
 * Stránka se nedá posouvat do strany — nic nepřečnívá z okna.
 *
 * Smysl má jen na telefonu, proto test bez štítku `@telefon` (a mimo
 * soubory z `e2e/telefon.ts`) spadne: na telefonech by se vůbec nepustil
 * a kontrola by tiše běžela jen na širokém desktopu.
 */
export async function bezVodorovnehoPosuvu(page: Page) {
  const info = test.info();
  if (!beziNaTelefonu(info.file, info.tags)) {
    throw new Error(
      `Test kontroluje rozložení na telefonu, ale nemá štítek ${STITEK_TELEFON} — přidej { tag: "${STITEK_TELEFON}" } (e2e/telefon.ts).`,
    );
  }
  const prectiva = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(prectiva, "stránka nesmí jít posouvat do strany").toBeLessThanOrEqual(1);
}

/**
 * Založí klienta formulářem a vrátí adresu jeho karty.
 *
 * Klient připadne tomu, kdo ho zakládá — proto si tudy testy obstarávají
 * klienta, na kterého mají nárok. Seedoví klienti patří seedovým
 * obchodníkům, ne zkušebním účtům z `priprava.setup.ts`.
 */
export async function zalozKlientaFormularem(page: Page, jmeno: string): Promise<string> {
  await page.goto("/klienti");
  await page.getByRole("button", { name: "Nový klient" }).click();

  const dialog = page.getByRole("dialog", { name: "Nový klient" });
  await dialog.getByLabel("Jméno a příjmení").fill(jmeno);
  await dialog
    .getByLabel("E-mail")
    .fill(`${jmeno.toLowerCase().replaceAll(" ", ".")}@example.test`);
  await dialog.getByRole("combobox", { name: "Odkud o nás ví" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByLabel("Nesouhlasí").check();
  await dialog.getByRole("button", { name: "Založit klienta" }).click();

  await cekejNaUspech(page, `${jmeno} je v seznamu klientů.`);
  await expect(page).toHaveURL(/\/klienti\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: jmeno })).toBeVisible();
  return new URL(page.url()).pathname;
}
