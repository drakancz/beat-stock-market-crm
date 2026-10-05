import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Secret, TOTP } from "otpauth";

/**
 * Dvoufázové ověření kódem z aplikace v telefonu (TOTP).
 *
 * Auth.js tohle neumí, takže je to vlastní kód. Drží se ale běžného
 * standardu (RFC 6238), takže funguje s Google Authenticatorem, 1Passwordem,
 * Bitwardenem i čímkoli dalším.
 *
 * Co se ukládá do databáze:
 * - tajemství **zašifrované** (viz `src/lib/tajemstvi.ts`),
 * - záložní kódy jen jako **otisky**, nikdy čitelně.
 */

const VYDAVATEL = "Beat Stock Market CRM";

/** Kolik kroků zpět a vpřed se ještě uzná — kvůli rozjetým hodinám. */
const TOLERANCE = 1;

/** Délka platnosti jednoho kódu v sekundách (standard TOTP). */
const PERIODA = 30;

const POCET_ZALOZNICH_KODU = 10;

/** Po kolika špatných pokusech se účet dočasně uzamkne. */
export const MAX_POKUSU = 10;
export const UZAMCENI_MINUT = 15;

function generator(tajemstvi: string, email: string): TOTP {
  return new TOTP({
    issuer: VYDAVATEL,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: PERIODA,
    secret: Secret.fromBase32(tajemstvi),
  });
}

/** Nové tajemství pro generátor kódů. Vrací se v podobě pro uložení. */
export function noveTajemstvi(): string {
  return new Secret({ size: 20 }).base32;
}

/** Adresa pro QR kód, kterou načte aplikace v telefonu. */
export function adresaProQr(tajemstvi: string, email: string): string {
  return generator(tajemstvi, email).toString();
}

/**
 * Ověří šestimístný kód a vrátí číslo jeho třicetisekundového okna,
 * nebo `null`, když kód nesedí.
 *
 * **Kód platí jednou** (26. 9. 2026). Číslo okna si volající uloží do
 * `two_factors.lastUsedStep` a kód ze stejného nebo staršího okna už
 * nepřijme — kdo by kód odkoukal i s heslem, nemůže se jím přihlásit
 * podruhé, dokud platí.
 */
export function overKod(tajemstvi: string, email: string, kod: string): number | null {
  const ocisteny = kod.replace(/\D/g, "");
  if (ocisteny.length !== 6) return null;

  const posun = generator(tajemstvi, email).validate({ token: ocisteny, window: TOLERANCE });
  if (posun === null) return null;
  return Math.floor(Date.now() / 1000 / PERIODA) + posun;
}

/**
 * Nové záložní kódy.
 *
 * Vrací čitelné kódy (ukážou se uživateli jednou) a jejich otisky
 * (ty jediné se ukládají).
 */
export async function noveZalozniKody(): Promise<{ kody: string[]; otisky: string[] }> {
  const kody = Array.from({ length: POCET_ZALOZNICH_KODU }, () =>
    randomBytes(5).toString("hex").toLowerCase(),
  );

  const otisky = await Promise.all(kody.map((kod) => bcrypt.hash(kod, 10)));

  return { kody, otisky };
}

/**
 * Najde otisk odpovídající zadanému záložnímu kódu.
 *
 * Vrací otisk, aby ho volající mohl z databáze odstranit — každý kód
 * platí jen jednou. `null` znamená, že kód nesedí.
 */
export async function najdiZalozniKod(kod: string, otisky: string[]): Promise<string | null> {
  const ocisteny = kod.trim().toLowerCase();
  if (ocisteny.length === 0) return null;

  for (const otisk of otisky) {
    if (await bcrypt.compare(ocisteny, otisk)) return otisk;
  }

  return null;
}
