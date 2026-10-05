import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { sestavViewer, type Viewer } from "@/lib/session";
import { otiskTokenu } from "@/lib/tajemstvi";

/**
 * Klíče pro přístup přes MCP (Jakub, 27. 9. 2026).
 *
 * **Oprávnění:**
 * - vytvořit a zrušit klíč smí **jen administrátor**, a jen svůj
 *   (akce v `src/app/(app)/profil/mcp-actions.ts`),
 * - přes klíč se vidí **přesně to, co jeho majitel** — klíč nenese žádná
 *   vlastní práva, jen říká, kdo se ptá (security_warnings.md, pravidlo 4),
 * - nepřihlášený bez platného klíče nedostane nic (`401`).
 *
 * Klíč přestane platit sám, když majitel přestane být administrátorem,
 * přijde o přístup, skončí ve Smazaných nebo mu chybí povinné dvoufázové
 * ověření. Kontroluje se to **při každém volání**, ne při vydání — stejně
 * jako `getViewer()` u přihlášení v prohlížeči.
 */

/** Předpona, podle které se klíč pozná v konfiguraci i v omylem vloženém textu. */
const PREDPONA = "crm_";

/** Kolik znaků ze začátku klíče se ukazuje v seznamu. */
const DELKA_ZACATKU = 12;

/** Nejvýš tolik platných klíčů na člověka — víc je spíš zapomenutý úklid. */
export const MAX_KLICU = 10;

/** Z čeho se vybírá platnost ve formuláři. `0` = do zrušení. */
export const PLATNOSTI_DNU = [30, 90, 365, 0] as const;

export type PlatnostDnu = (typeof PLATNOSTI_DNU)[number];

/**
 * Nový klíč — 256 náhodných bitů s předponou.
 *
 * Vrací klíč v čitelné podobě **jen volajícímu**, který ho jednou ukáže
 * majiteli. Do databáze jde otisk.
 */
export function novyKlic(): { klic: string; otisk: string; zacatek: string } {
  const klic = PREDPONA + randomBytes(32).toString("base64url");
  return { klic, otisk: otiskTokenu(klic), zacatek: klic.slice(0, DELKA_ZACATKU) };
}

/** Klíč z hlavičky `Authorization: Bearer …`, jinak `null`. */
export function klicZHlavicky(hlavicky: Headers): string | null {
  const hodnota = hlavicky.get("authorization")?.trim();
  if (!hodnota) return null;

  const shoda = /^Bearer\s+(\S+)$/i.exec(hodnota);
  const klic = shoda?.[1];
  // Tvar se ověří dřív, než se sáhne do databáze. Delší řetězec, než
  // jaký generátor vyrábí, je pokus o něco jiného.
  if (!klic || !klic.startsWith(PREDPONA) || klic.length > 80) return null;
  return klic;
}

export type OvereniKlice =
  | { ok: true; viewer: Viewer; klicId: string; smiZapisovat: boolean }
  | { ok: false; duvod: "neznamy" | "zruseny" | "propadly" | "ucet" };

/**
 * Ověří klíč a vrátí, kdo se ptá.
 *
 * Důvod neúspěchu se volajícímu **neposílá** — odpověď je vždy stejné
 * `401`, aby se z ní nedalo poznat, jestli klíč kdysi existoval.
 * Důvod slouží jen k logu serveru.
 */
export async function overKlic(klic: string): Promise<OvereniKlice> {
  const zaznam = await db.mcpKey.findUnique({
    where: { keyHash: otiskTokenu(klic) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      canWrite: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          deletedAt: true,
          twoFactorEnabled: true,
          firstName: true,
          vocative: true,
        },
      },
    },
  });

  if (!zaznam) return { ok: false, duvod: "neznamy" };
  if (zaznam.revokedAt) return { ok: false, duvod: "zruseny" };
  if (zaznam.expiresAt && zaznam.expiresAt < new Date()) return { ok: false, duvod: "propadly" };

  const uzivatel = zaznam.user;
  // Stejné podmínky jako u přihlášení v prohlížeči, navíc role:
  // klíč si smí vytvořit jen administrátor a jen jako administrátor platí.
  if (!uzivatel.active || uzivatel.deletedAt || uzivatel.role !== "ADMINISTRATOR") {
    return { ok: false, duvod: "ucet" };
  }

  const viewer = sestavViewer(uzivatel, await nactiNastaveni());
  // Povinné dvoufázové ověření, které si majitel nezapnul — do CRM se
  // nedostane ani přes obrazovky, tak ani tudy.
  if (viewer.chybiDvoufazove) return { ok: false, duvod: "ucet" };

  return { ok: true, viewer, klicId: zaznam.id, smiZapisovat: zaznam.canWrite };
}

/** Poznamená poslední použití. Selhání nesmí shodit odpověď. */
export async function poznamenejPouziti(klicId: string): Promise<void> {
  try {
    await db.mcpKey.update({ where: { id: klicId }, data: { lastUsedAt: new Date() } });
  } catch (chyba) {
    console.error(
      "Použití klíče MCP se nepodařilo zapsat:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/** Klíče jednoho člověka pro Můj profil — nejnovější první, zrušené na konci. */
export async function nactiKlice(userId: string) {
  const klice = await db.mcpKey.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      canWrite: true,
    },
  });

  const ted = new Date();
  return klice.map((klic) => ({
    ...klic,
    platny: !klic.revokedAt && (!klic.expiresAt || klic.expiresAt > ted),
  }));
}
