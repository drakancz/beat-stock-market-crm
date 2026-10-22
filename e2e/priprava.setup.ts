import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test as priprava } from "@playwright/test";

import { SOUBOR_UCTU, prihlas, stavPrihlaseni, zalozUzivatele, type RoleTestu } from "./pomocne";

/**
 * Příprava před testy: pro každou roli jeden zkušební účet a jeho
 * přihlášení uložené do `e2e/.stav/` (mimo repozitář).
 *
 * Hesla jsou náhodná pro každý běh a do souborů se nezapisují — uloží se
 * jen cookie se sezením v testovací databázi, která se při dalším běhu
 * stejně vymaže.
 */

const ROLE: RoleTestu[] = ["admin", "uzivatel"];

// Obrazovky, které se při prvním otevření překládají dlouho. Otevřou se
// předem, ať se čekání nepočítá do lhůt jednotlivých testů.
const ZAHRATI = [
  "/dashboard",
  "/klienti",
  "/objednavky",
  "/brokeri",
  "/produkty",
  "/produkty/slevove-kody",
  "/produkty/doporucitele",
  "/profil",
  "/sprava",
  "/sprava/uzivatele",
  "/smazane",
  "/smartemailing",
  "/nastaveni",
];

priprava.describe.configure({ mode: "serial" });

priprava("zkušební účty a jejich přihlášení", async ({ browser, request }) => {
  priprava.setTimeout(600_000);
  await mkdir(path.dirname(SOUBOR_UCTU), { recursive: true });

  /*
   * Počkat, až je přihlašovací API opravdu přeložené (21. 9. 2026).
   *
   * Čerstvě spuštěný `next dev` překládá `/api/auth/[...nextauth]` až
   * při prvním požadavku. Když do něj vběhne rovnou přihlášení, vrátí
   * místo dat stránku a formulář spadne na „Unexpected token '<'" —
   * spadla tak celá příprava a s ní celá sada. Dvakrát za den.
   */
  await expect(async () => {
    const odpoved = await request.get("/api/auth/csrf");
    expect(odpoved.ok(), "přihlašovací API ještě neodpovídá").toBeTruthy();
    expect(odpoved.headers()["content-type"] ?? "").toContain("json");
  }).toPass({ timeout: 180_000 });

  const ucty: Record<string, { id: string; name: string; email: string }> = {};

  for (const role of ROLE) {
    const ucet = await zalozUzivatele(role);
    ucty[role] = { id: ucet.id, name: ucet.name, email: ucet.email };

    const kontext = await browser.newContext();
    const page = await kontext.newPage();

    await prihlas(page, ucet.email, ucet.heslo);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 180_000 });

    await kontext.storageState({ path: stavPrihlaseni(role) });

    if (role === "admin") {
      for (const adresa of ZAHRATI) await page.goto(adresa);
    }

    await kontext.close();
  }

  await writeFile(SOUBOR_UCTU, JSON.stringify(ucty, null, 2));
});
