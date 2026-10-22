import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";

/**
 * Štítky u klientů (Fáze 5B, Jakub 11. 10. 2026).
 *
 * | Kdo           | Smí                                                       |
 * | ------------- | --------------------------------------------------------- |
 * | uživatel      | vidět štítky, přidat a odebrat je u klienta (i hromadně)  |
 * | administrátor | navíc seznam štítků: založit, přejmenovat, barva, smazat  |
 *
 * **Klient štítky nevidí nikdy.** Přes MCP je AI vidí (jako jména), Asistent
 * AI je nedostane (`ZAHOZENA_POLE` v `asistent/prezdivky.ts`).
 *
 * Přidání i odebrání jde přes `nastavStitek()` — stejná funkce pro kartu
 * klienta i hromadnou akci, stejný audit (`klient.stitek-pridan` /
 * `-odebran`, s názvem štítku).
 */

/** Nabídka štítků — jen nesmazané, podle názvu. */
export async function nactiStitky() {
  return db.clientTag.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
}

/** Nejvíc klientů v jedné hromadné akci — víc jich seznam stejně neukáže najednou. */
export const MAX_HROMADNE = 1000;

/**
 * Přidá, nebo odebere štítek vybraným klientům. Klienti mimo viditelnost
 * a smazaní se tiše přeskočí (dotaz s `viditelniKlienti()`). Vrací, kolika
 * klientům se něco změnilo.
 */
export async function nastavStitek(
  viewer: Viewer,
  clientIds: string[],
  tagId: string,
  pridat: boolean,
): Promise<{ ok: true; zmeneno: number; stitek: string } | { ok: false; chyba: string }> {
  const stitek = await db.clientTag.findFirst({
    where: { id: tagId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!stitek) return { ok: false, chyba: "Takový štítek neexistuje." };

  const klienti = await db.client.findMany({
    where: { AND: [{ id: { in: clientIds } }, viditelniKlienti(viewer)] },
    select: { id: true, stitky: { where: { tagId: stitek.id }, select: { tagId: true } } },
  });
  // Jen ti, u kterých se opravdu něco změní — audit bez prázdných zápisů.
  const dotceni = klienti.filter((k) => (pridat ? k.stitky.length === 0 : k.stitky.length > 0));
  if (dotceni.length === 0) return { ok: true, zmeneno: 0, stitek: stitek.name };

  await db.$transaction(async (tx) => {
    if (pridat) {
      await tx.clientTagLink.createMany({
        data: dotceni.map((k) => ({ clientId: k.id, tagId: stitek.id, addedById: viewer.id })),
        skipDuplicates: true,
      });
    } else {
      await tx.clientTagLink.deleteMany({
        where: { tagId: stitek.id, clientId: { in: dotceni.map((k) => k.id) } },
      });
    }
    for (const klient of dotceni) {
      await zapisDoAuditu(tx, {
        userId: viewer.id,
        entity: "clients",
        entityId: klient.id,
        action: pridat ? "klient.stitek-pridan" : "klient.stitek-odebran",
        after: { stitek: stitek.name, ...(dotceni.length > 1 ? { hromadne: true } : {}) },
      });
    }
  });

  return { ok: true, zmeneno: dotceni.length, stitek: stitek.name };
}
