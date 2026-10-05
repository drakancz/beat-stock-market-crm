import * as Sentry from "@sentry/node";

import { spolecneNastaveni } from "../src/lib/sentry/nastaveni";

/**
 * Zkouška propojení se Sentry.
 *
 * Spouští se ručně:
 *   docker compose run --rm web npm run sentry:zkouska
 *
 * Pošle jednu zkušební chybu a vypíše její číslo. V Sentry se má objevit
 * do minuty. **Do textu schválně dává vymyšlené osobní údaje** — v Sentry
 * pak musí být vidět `[e-mail]` a `[telefon]` místo nich. Je to jediné
 * místo, kde se z vývoje něco do Sentry posílá; běžný provoz hlásí jen
 * nasazená aplikace.
 *
 * Údaje jsou **vymyšlené**, ne výřez z ostrých dat (pravidlo 8).
 */

const nastaveni = spolecneNastaveni();

if (!nastaveni.dsn) {
  console.error(
    "Chybí NEXT_PUBLIC_SENTRY_DSN. Doplň adresu projektu do .env " +
      "(Sentry → Settings → Projects → Client Keys).",
  );
  process.exit(1);
}

Sentry.init({
  ...nastaveni,
  // Zkouška se pouští ručně z vývoje, takže se hlášení musí zapnout
  // natvrdo — jinak by ho `jeZapnute()` (jen produkce) zahodilo.
  enabled: true,
  environment: "zkouska",
});

Sentry.setUser({ id: "zkouska-uzivatel", role: "ADMINISTRATOR" });

async function main() {
  // Pokaždé jiný kód, aby Sentry zkoušku nesloučilo s tou předchozí —
  // stejný text se totiž přidá k už existující položce a vypadá to, jako
  // by hlášení nedorazilo.
  const kod = Math.random().toString(36).slice(2, 8).toUpperCase();

  const id = Sentry.captureException(
    new Error(
      `Zkušební chyba z CRM Beat Stock Market [${kod}]. ` +
        "Kontrola anonymizace: jan.novak@example.test, +420 601 234 567.",
    ),
  );

  console.info(`      Hledej v Sentry text: Zkušební chyba z CRM Beat Stock Market [${kod}]`);

  const odeslano = await Sentry.flush(10_000);

  if (!odeslano) {
    console.error("Hlášení se nepodařilo odeslat. Zkontroluj adresu projektu a připojení.");
    process.exit(1);
  }

  console.info(`OK    zkušební chyba odeslaná do Sentry, číslo hlášení: ${id}`);
  console.info("      V Sentry musí být místo e-mailu a telefonu [e-mail] a [telefon].");
}

void main();
