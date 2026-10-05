import { db } from "@/lib/db";

/**
 * Hledání bez ohledu na diakritiku a velikost písmen (Jakub, 25. 9. 2026).
 *
 * „maresova" najde „Marešová", „DVORAK" najde „Dvořák" — a naopak.
 * Prisma to sama neumí (`mode: "insensitive"` řeší jen velikost písmen),
 * proto se shoda hledá v databázi funkcí `unaccent` (migrace
 * `20260925170000_hledani_bez_diakritiky`) a Prisma pak dostane jen
 * seznam id. Omezení viditelnosti a `deletedAt` zůstávají v dotazu
 * Prismy, tady se jen hledá shoda.
 *
 * Porovnává se přes `strpos()`, ne `LIKE` — znaky `%` a `_` z hledání
 * tak nic nezpůsobí a nemusí se nijak upravovat. Text jde do dotazu jako
 * parametr, nikdy se do SQL nevlepuje (security_warnings.md, pravidlo 11).
 */

/** Id klientů, jejichž jméno nebo e-mail obsahuje `text`. */
export async function klientiPodleTextu(text: string): Promise<string[]> {
  const radky = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM clients
    WHERE strpos(unaccent(lower(name)), unaccent(lower(${text}))) > 0
       OR strpos(unaccent(lower(email)), unaccent(lower(${text}))) > 0`;
  return radky.map((radek) => radek.id);
}

/**
 * Id klientů, jejichž telefon obsahuje číslice z `text` — bez ohledu na
 * mezery (Jakub, 26. 9. 2026). „601234567" najde „+420 601 234 567"
 * a obráceně. Pod tři číslice se nehledá, jinak by „1" našlo skoro všechny.
 */
export async function klientiPodleTelefonu(text: string): Promise<string[]> {
  const cislice = text.replace(/\D/g, "");
  if (cislice.length < 3) return [];

  const radky = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM clients
    WHERE strpos(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), ${cislice}) > 0`;
  return radky.map((radek) => radek.id);
}

/** Id produktů, jejichž název obsahuje `text`. */
export async function produktyPodleTextu(text: string): Promise<string[]> {
  const radky = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM products
    WHERE strpos(unaccent(lower(name)), unaccent(lower(${text}))) > 0`;
  return radky.map((radek) => radek.id);
}
