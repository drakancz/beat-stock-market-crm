import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db";

/**
 * Chyba, kterou vyhodí `overDatabazi()`. Vlastní třída proto, aby se
 * v Sentry poznala na první pohled od ostatních pádů stránky.
 */
export class DatabazeNedostupna extends Error {
  constructor(pricina: unknown) {
    super("Databáze neodpovídá");
    this.name = "DatabazeNedostupna";
    this.cause = pricina;
  }
}

/**
 * Ověří, že databáze odpovídá. Když ne, vyhodí chybu.
 *
 * **Proč to existuje** (Jakub, 20. 9. 2026): přihlašovací stránka slouží
 * jako kontrola zdraví pro Railway i pro sledování dostupnosti zvenku.
 * Sama o sobě se ale databáze ptá jen tehdy, když má návštěvník v
 * prohlížeči přihlášení — bez něj `getViewer()` skončí dřív. Stalo se
 * proto, že stránka po změně hesla k databázi odpovídala „v pořádku",
 * přestože se aplikace do databáze nedostala. Tenhle dotaz to odhalí.
 *
 * **Co uvidí kdo:** návštěvníkovi se ukáže obecné „Něco se pokazilo"
 * (`src/app/global-error.tsx`) — z odpovědi se nemá dát vyčíst, co přesně
 * je rozbité. Že jde o databázi, se dozví jen administrátor ze Sentry
 * a z logu serveru (Jakub, 20. 9. 2026).
 *
 * Dotaz je ten nejmenší možný: nic nečte ani nezapisuje, jen ověří, že
 * spojení stojí a databáze odpovídá.
 */
export async function overDatabazi(): Promise<void> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (pricina) {
    const chyba = new DatabazeNedostupna(pricina);

    // Do Sentry jde druh chyby a text od ovladače databáze — nikdy
    // připojovací adresa, v níž je heslo (security.md, pravidlo 5).
    // Filtr `bezOsobnichUdaju()` na hlášku sáhne ještě jednou.
    Sentry.captureException(chyba, { tags: { zdravi: "databaze" } });

    throw chyba;
  }
}
