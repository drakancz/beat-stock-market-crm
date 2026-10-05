import { db } from "@/lib/db";
import type { Obdobi } from "@/lib/obdobi";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";

/**
 * Konverzní trychtýř na Dashboardu (Jakub, 27. 9. 2026, krok 2B).
 *
 * Tři stupně pro klienty, kteří přibyli ve zvoleném období:
 * **noví klienti → z nich objednali → z nich zaplatili**. Objednávka
 * i platba se počítají kdykoli, i po konci období — trychtýř sleduje, co
 * se s lidmi z období stalo, ne co se v období stalo.
 *
 * Smazané objednávky se nepočítají (stejně jako tržby). Sloučené karty
 * jsou ve Smazaných, takže člověk se počítá jednou.
 *
 * **Vidí každý přihlášený** (Jakub) — omezení je v dotazu přes
 * `viditelniKlienti()`, stejně jako u ostatních čísel na Dashboardu.
 */

export interface StupenZdroje {
  zdroj: string;
  noviKlienti: number;
  objednali: number;
  zaplatili: number;
}

export interface Trychtyr {
  noviKlienti: number;
  objednali: number;
  zaplatili: number;
  /** Podle zdroje, nejvíc nových klientů první. */
  podleZdroje: StupenZdroje[];
}

export async function nactiTrychtyr(viewer: Viewer, obdobi: Obdobi): Promise<Trychtyr> {
  const klienti = await db.client.findMany({
    where: {
      AND: [viditelniKlienti(viewer), { createdAt: { gte: obdobi.od, lt: obdobi.do } }],
    },
    select: {
      source: { select: { name: true } },
      _count: {
        select: {
          orders: { where: { deletedAt: null } },
        },
      },
      orders: {
        where: { deletedAt: null, status: "ZAPLACENO" },
        select: { id: true },
        take: 1,
      },
    },
  });

  const zdroje = new Map<string, StupenZdroje>();
  let objednali = 0;
  let zaplatili = 0;

  for (const klient of klienti) {
    const objednal = klient._count.orders > 0;
    const zaplatil = klient.orders.length > 0;
    if (objednal) objednali += 1;
    if (zaplatil) zaplatili += 1;

    const nazev = klient.source.name;
    const radek = zdroje.get(nazev) ?? { zdroj: nazev, noviKlienti: 0, objednali: 0, zaplatili: 0 };
    radek.noviKlienti += 1;
    if (objednal) radek.objednali += 1;
    if (zaplatil) radek.zaplatili += 1;
    zdroje.set(nazev, radek);
  }

  return {
    noviKlienti: klienti.length,
    objednali,
    zaplatili,
    podleZdroje: [...zdroje.values()].sort(
      (a, b) => b.noviKlienti - a.noviKlienti || a.zdroj.localeCompare(b.zdroj, "cs"),
    ),
  };
}

/** Podíl v procentech, zaokrouhlený; z nuly je nula. */
export function podil(cast: number, celek: number): number {
  return celek === 0 ? 0 : Math.round((cast / celek) * 100);
}
