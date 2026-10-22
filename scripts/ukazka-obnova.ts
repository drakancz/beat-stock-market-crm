import { db } from "../src/lib/db";
import { obnovUkazku } from "../src/lib/ukazka-obnova";

/**
 * Obnova ukázky ručně — na zkoušku u sebe (`npm run ukazka:obnova`).
 *
 * Na serveru ji spouští denní plánovač. Tady **smaže všechno kromě účtů
 * týmu v databázi z `DATABASE_URL`**, proto se pustí jen se zapnutým
 * ukázkovým režimem (`UKAZKA=1`) a nad databází, která má v názvu
 * `ukazka` — vývojová databáze `crm` ani testovací `crm_test` tím
 * omylem nezmizí. Postup je v `docs/funkce/ukazka.md`.
 */
const adresa = process.env.DATABASE_URL ?? "";
const nazev = /\/([^/?]+)(\?|$)/.exec(adresa.replace(/^[a-z]+:\/\/[^/]+/, ""))?.[1] ?? "";

if (process.env.UKAZKA !== "1" || !nazev.includes("ukazka")) {
  console.error(
    `Obnova ukázky smaže data. Pustí se jen s UKAZKA=1 nad databází s „ukazka“ v názvu (teď: „${nazev}“).`,
  );
  process.exit(1);
}

obnovUkazku()
  .then((vysledek) => console.log("Ukázka obnovena:", vysledek))
  .catch((chyba) => {
    console.error("Obnova ukázky selhala:", chyba);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
