import { db } from "@/lib/db";
import { dnesniZacatek } from "@/lib/platnost";
import { jeUkazka, UKAZKOVY_TYM } from "@/lib/ukazka";
import { naplnUkazku } from "@/lib/ukazka-data";

/**
 * Noční obnova ukázky (Jakub, 22. 10. 2026).
 *
 * Volá ji denní plánovač (`POST /api/planovac`) — **jen v ukázkovém
 * režimu**, jinde by smazala ostrá data. Vyčistí všechny tabulky kromě
 * účtů týmu a naplní ukázku znovu (`ukazka-data.ts`). Co návštěvníci přes
 * den změnili, zmizí, včetně Aktivity a auditu — v ukázce je to záměr.
 *
 * **Zůstávají účty týmu** (Jakub vybral „účty týmu zůstanou“): `users`,
 * jejich dvoufázové ověření a klíče MCP. Na nic dalšího neodkazují, takže
 * je `TRUNCATE … CASCADE` nepoškodí. Ukázkový člen týmu se při plnění
 * vrátí do výchozího stavu (heslo, role, bez dvoufázového ověření).
 *
 * Názvy tabulek se berou z katalogu databáze, ne zvenku; i tak se pustí
 * jen tvar `[a-z_]+`.
 */

const ZUSTAVA = new Set(["_prisma_migrations", "users", "two_factors", "mcp_keys"]);

/**
 * Obnoví ukázku, **nejvýš jednou za pražský den** — plánovač může běžet
 * častěji (webináře) a obnova uprostřed dne by návštěvníkovi smazala
 * rozdělanou práci. Poznávací znamení je čas nastavení hesla ukázkového
 * člena týmu: `users` se nečistí a obnova ho pokaždé nastaví znovu.
 */
export async function obnovUkazkuJednouDenne() {
  const ucet = await db.user.findUnique({
    where: { email: UKAZKOVY_TYM.email },
    select: { passwordSetAt: true },
  });
  if (ucet?.passwordSetAt && ucet.passwordSetAt >= dnesniZacatek()) {
    return { obnoveno: false as const };
  }
  return { obnoveno: true as const, ...(await obnovUkazku()) };
}

export async function obnovUkazku() {
  if (!jeUkazka()) throw new Error("Obnova ukázky běží jen v ukázkovém režimu (UKAZKA=1).");

  const tabulky = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
  const smazat = tabulky
    .map((t) => t.tablename)
    .filter((nazev) => !ZUSTAVA.has(nazev) && /^[a-z_]+$/.test(nazev));

  if (smazat.length > 0) {
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE ${smazat.map((nazev) => `"${nazev}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }

  return { vycisteno: smazat.length, ...(await naplnUkazku()) };
}
