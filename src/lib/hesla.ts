import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Hesla.
 *
 * Auth.js sám hesla neřeší — s přihlášením heslem si obsluhu píše každý
 * projekt sám. Proto je tenhle soubor jediné místo, kde se s heslem
 * pracuje, a nikde jinde se `bcrypt` nevolá.
 *
 * Ukládá se výhradně **otisk** (bcrypt, cost 12). Heslo v čitelné podobě
 * se nikam nezapisuje — ani do databáze, ani do logu
 * (security_warnings.md, pravidlo 3).
 */

const COST = 12;

/** Minimum pro systém, který drží portfolia klientů. */
export const MIN_DELKA_HESLA = 12;

/**
 * Strop je **72 bajtů**, ne znaků. bcrypt počítá jen prvních 72 bajtů
 * hesla a zbytek tiše zahodí — se stropem 128 by dlouhé heslo budilo
 * dojem větší síly, než jakou má, a jeho konec by na přihlášení neměl
 * vliv. Diakritika zabere v UTF-8 dva bajty, proto se měří bajty.
 */
export const MAX_BAJTU_HESLA = 72;

/**
 * Otisk, se kterým se neshoduje žádné heslo.
 *
 * Používá se, když e-mail v systému není: porovnání proběhne naprázdno,
 * aby odpověď trvala stejně dlouho jako u existujícího účtu. Bez toho by
 * šlo podle rychlosti odpovědi zjistit, kdo ve firmě pracuje — i když je
 * chybová hláška pokaždé stejná.
 */
const OTISK_NAPRAZDNO = "$2b$12$0000000000000000000000000000000000000000000000000000";

export async function zahesluj(heslo: string): Promise<string> {
  return bcrypt.hash(heslo, COST);
}

export async function overHeslo(heslo: string, otisk: string | null): Promise<boolean> {
  if (!otisk) {
    // Účet bez hesla (čeká na první nastavení). Porovnáme naprázdno,
    // ať odpověď trvá stejně dlouho.
    await bcrypt.compare(heslo, OTISK_NAPRAZDNO).catch(() => false);
    return false;
  }

  return bcrypt.compare(heslo, otisk);
}

/** Nové heslo — kontrola délky. Běží na serveru, ne jen v prohlížeči (pravidlo 11). */
export const noveHesloSchema = z
  .string({ error: "Chybí heslo." })
  .min(MIN_DELKA_HESLA, `Heslo musí mít alespoň ${MIN_DELKA_HESLA} znaků.`)
  .refine(
    (heslo) => new TextEncoder().encode(heslo).length <= MAX_BAJTU_HESLA,
    `Heslo je příliš dlouhé (nejvýš ${MAX_BAJTU_HESLA} znaků; s diakritikou méně).`,
  );

export function zkontrolujHeslo(heslo: unknown): { ok: true } | { ok: false; chyba: string } {
  const vysledek = noveHesloSchema.safeParse(heslo);
  return vysledek.success ? { ok: true } : { ok: false, chyba: vysledek.error.issues[0]!.message };
}
