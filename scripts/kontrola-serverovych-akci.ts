import { globSync, readFileSync } from "node:fs";

import { pocet } from "../src/lib/mnozne";

/**
 * Kontrola souborů se serverovými akcemi.
 *
 * Spouští se jako součást kontroly typů:
 *   docker compose run --rm web npm run typecheck
 *
 * **Soubor s `"use server"` smí vyvážet jen asynchronní funkce.** Když
 * z něj vyleze cokoli jiného — konstanta, pole, objekt, obyčejná funkce —
 * Next celý modul zahodí a hlásí, že požadovaný export neexistuje.
 *
 * Nejhorší na tom je, že to **nepozná ani kontrola typů, ani lint**.
 * V rozhraní se to projeví tak, že tlačítko nedělá vůbec nic, nebo se
 * stránka vůbec nenačte. Stalo se to při psaní koše i při přidávání
 * brokera do formuláře klienta — pokaždé se na to přišlo až klikáním
 * v prohlížeči.
 *
 * `export type` a `export interface` jsou v pořádku: typy se při překladu
 * zahodí a v hotovém kódu po nich nezůstane nic.
 */

/** Co smí být v takovém souboru vyvezené. */
const POVOLENE = [
  /^export async function\s/,
  /^export type\s/,
  /^export interface\s/,
  // `export type { … }` v jiném zápisu.
  /^export\s+type\s*\{/,
];

/** Jak se to pozná, že jde o soubor se serverovými akcemi. */
function jeServerovy(obsah: string): boolean {
  const prvniRadky = obsah.split("\n", 5).join("\n");
  return /^\s*["']use server["']/m.test(prvniRadky);
}

function main() {
  const soubory = globSync("src/**/*.{ts,tsx}");

  let chyb = 0;
  let zkontrolovano = 0;

  for (const cesta of soubory) {
    const obsah = readFileSync(cesta, "utf8");
    if (!jeServerovy(obsah)) continue;

    zkontrolovano += 1;

    obsah.split("\n").forEach((radek, index) => {
      // Zajímají jen vývozy na začátku řádku, tedy ty na nejvyšší úrovni
      // souboru. Uvnitř funkce žádný `export` být nemůže.
      if (!radek.startsWith("export")) return;
      if (POVOLENE.some((vzor) => vzor.test(radek))) return;

      chyb += 1;
      console.error(
        `CHYBA ${cesta}:${index + 1}\n` +
          `      ${radek.trim()}\n` +
          `      Soubor s "use server" smí vyvážet jen asynchronní funkce (a typy).\n` +
          `      Přesuň tuhle hodnotu do vlastního souboru — jinak Next celý modul zahodí.`,
      );
    });
  }

  if (chyb === 0) {
    console.info(`OK    serverové akce: ${zkontrolovano} souborů, jen asynchronní funkce a typy`);
    return;
  }

  console.error(`\n${pocet(chyb, "vývoz", "vývozy", "vývozů")}, které tam nepatří.`);
  process.exit(1);
}

main();
