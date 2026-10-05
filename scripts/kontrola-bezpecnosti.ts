import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";

import { adresaProQr, najdiZalozniKod, noveTajemstvi, overKod } from "../src/lib/dvoufazove";
import { overHeslo, zahesluj } from "../src/lib/hesla";
import { otiskTokenu, rozsifruj, zasifruj } from "../src/lib/tajemstvi";

/**
 * Kontrola vlastnoručně psaných bezpečnostních částí.
 *
 * Spouští se:
 *   docker compose run --rm web npm run auth:kontrola
 *
 * Auth.js hesla, jejich obnovu ani dvoufázové ověření neumí, takže je to
 * náš kód. Na rozdíl od zbytku aplikace se u něj chyba neprojeví
 * spadlou stránkou, ale tichým vpuštěním nepovolaného — proto tahle
 * kontrola. Do databáze nesahá, dá se pustit kdykoli.
 */

let chyb = 0;

function overit(popis: string, podminka: boolean) {
  if (!podminka) chyb += 1;
  console.info(`${podminka ? "OK   " : "CHYBA"} ${popis}`);
}

async function main() {
  /* --- Šifrování tajemství pro dvoufázové ověření --- */
  const tajne = "JBSWY3DPEHPK3PXP";
  const zasifrovane = zasifruj(tajne);
  overit("zašifrovaný text se liší od původního", zasifrovane !== tajne);
  overit("rozšifrování vrátí původní text", rozsifruj(zasifrovane) === tajne);
  overit("dvakrát zašifrované dá jiný výsledek", zasifruj(tajne) !== zasifruj(tajne));

  let poskozeneOdhaleno = false;
  try {
    const [iv, znacka, data] = zasifrovane.split(".");
    rozsifruj(`${iv}.${znacka}.${data!.slice(0, -2)}XX`);
  } catch {
    poskozeneOdhaleno = true;
  }
  overit("podvržený zašifrovaný údaj se odmítne", poskozeneOdhaleno);

  /* --- Kódy z ověřovací aplikace --- */
  const tajemstvi = noveTajemstvi();
  const email = "kontrola@example.test";
  const generator = new TOTP({
    issuer: "Beat Stock Market CRM",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(tajemstvi),
  });

  overit("správný kód projde", overKod(tajemstvi, email, generator.generate()) !== null);
  // Kód platí jednou (26. 9. 2026): ověření vrací číslo půlminutového okna,
  // které si přihlášení uloží a starší ani stejné už nepřijme.
  overit(
    "správný kód vrátí svoje okno",
    overKod(tajemstvi, email, generator.generate()) === Math.floor(Date.now() / 30_000),
  );
  overit("špatný kód neprojde", overKod(tajemstvi, email, "000000") === null);
  overit("prázdný kód neprojde", overKod(tajemstvi, email, "") === null);
  overit(
    "kód od jiného tajemství neprojde",
    overKod(noveTajemstvi(), email, generator.generate()) === null,
  );
  overit("adresa pro QR je platná", adresaProQr(tajemstvi, email).startsWith("otpauth://totp/"));

  /* --- Hesla --- */
  const otisk = await zahesluj("SpravneHeslo2026!");
  overit("otisk hesla neobsahuje heslo", !otisk.includes("SpravneHeslo2026!"));
  overit("správné heslo projde", await overHeslo("SpravneHeslo2026!", otisk));
  overit("špatné heslo neprojde", !(await overHeslo("SpatneHeslo2026!", otisk)));
  overit("účet bez hesla nikoho nepustí", !(await overHeslo("cokoli", null)));

  /* --- Otisky tokenů z odkazů --- */
  overit("stejný token dá stejný otisk", otiskTokenu("abc") === otiskTokenu("abc"));
  overit("jiný token dá jiný otisk", otiskTokenu("abc") !== otiskTokenu("abd"));

  /* --- Záložní kódy --- */
  const otisky = await Promise.all(["aaa11", "bbb22"].map((k) => bcrypt.hash(k, 10)));
  overit("existující záložní kód se najde", (await najdiZalozniKod("aaa11", otisky)) !== null);
  overit("neexistující záložní kód se nenajde", (await najdiZalozniKod("ccc33", otisky)) === null);

  console.info(`\n${chyb === 0 ? "VŠE PROŠLO" : `NEPROŠLO: ${chyb} chyb`}`);
  if (chyb > 0) process.exitCode = 1;
}

main().catch((chyba: unknown) => {
  console.error("CHYBA:", chyba);
  process.exitCode = 1;
});
