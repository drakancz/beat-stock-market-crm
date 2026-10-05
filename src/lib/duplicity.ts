import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Možné duplicity klientů (Jakub, 27. 9. 2026, krok 2B).
 *
 * Příjem leadů a objednávek dvojníka se stejným e-mailem ani telefonem
 * nezaloží (`najdiExistujiciho()` v `leady.ts`). Duplicity přesto vznikají:
 * klient objedná z jiného e-mailu, kolega ho založí ručně, nebo jsou
 * v databázi starší záznamy. Tady se proto jen **navrhují**, rozhoduje
 * člověk — sloučit smí administrátor, „nejsou stejný člověk“ každý.
 *
 * Shoda (Jakub vybral):
 * - **stejný telefon** — porovnává se bez mezer, stejně jako při příjmu;
 * - **stejné jméno a příjmení** — bez ohledu na diakritiku, velikost
 *   písmen a mezery. Může chytit dva různé lidi, proto „nejsou stejný
 *   člověk“ (`client_not_duplicates`).
 *
 * Porovnávají se jen klienti mimo Smazané. Návrhy vidí každý přihlášený —
 * klienty v CRM vidí všichni (security.md, oddíl 3).
 */

export type DuvodShody = "telefon" | "jmeno";

export interface KlientDvojice {
  id: string;
  name: string;
  createdAt: Date;
  pocetObjednavek: number;
}

export interface MoznaDuplicita {
  a: KlientDvojice;
  b: KlientDvojice;
  duvody: DuvodShody[];
}

/** Popis důvodu pro člověka: „stejný telefon“, „stejné jméno“. */
export const POPIS_DUVODU: Record<DuvodShody, string> = {
  telefon: "stejný telefon",
  jmeno: "stejné jméno",
};

/**
 * Dvojice možných duplicit, nejnovější první.
 *
 * S `klientId` jen dvojice, ve kterých ten klient je (pruh na kartě).
 * Dotaz je parametrizovaný (pravidlo 11); porovnání dělá databáze, takže
 * se do aplikace netahají všichni klienti.
 */
export async function najdiDuplicity(klientId?: string): Promise<MoznaDuplicita[]> {
  const jenKlient = klientId
    ? Prisma.sql`AND (a."id" = ${klientId} OR b."id" = ${klientId})`
    : Prisma.empty;

  const radky = await db.$queryRaw<
    { aId: string; bId: string; telefon: boolean; jmeno: boolean }[]
  >`
    WITH k AS (
      SELECT "id",
             nullif(regexp_replace(coalesce("phone", ''), '[^0-9+]', '', 'g'), '') AS tel,
             unaccent(lower(regexp_replace(trim("name"), '\\s+', ' ', 'g'))) AS jmeno
      FROM "clients"
      WHERE "deletedAt" IS NULL
    )
    SELECT a."id" AS "aId", b."id" AS "bId",
           coalesce(a.tel = b.tel, false) AS "telefon",
           (a.jmeno = b.jmeno) AS "jmeno"
    FROM k a
    JOIN k b ON a."id" < b."id" AND (a.tel = b.tel OR a.jmeno = b.jmeno)
    WHERE NOT EXISTS (
      SELECT 1 FROM "client_not_duplicates" n
      WHERE n."clientAId" = a."id" AND n."clientBId" = b."id"
    )
    ${jenKlient}
    LIMIT 500`;

  if (radky.length === 0) return [];

  const ids = [...new Set(radky.flatMap((radek) => [radek.aId, radek.bId]))];
  const klienti = await db.client.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { orders: { where: { deletedAt: null } } } },
    },
  });
  const podleId = new Map(
    klienti.map((klient) => [
      klient.id,
      {
        id: klient.id,
        name: klient.name,
        createdAt: klient.createdAt,
        pocetObjednavek: klient._count.orders,
      },
    ]),
  );

  return radky
    .flatMap((radek) => {
      const a = podleId.get(radek.aId);
      const b = podleId.get(radek.bId);
      if (!a || !b) return [];
      const duvody: DuvodShody[] = [];
      if (radek.telefon) duvody.push("telefon");
      if (radek.jmeno) duvody.push("jmeno");
      return [{ a, b, duvody }];
    })
    .sort(
      (x, y) =>
        Math.max(y.a.createdAt.getTime(), y.b.createdAt.getTime()) -
        Math.max(x.a.createdAt.getTime(), x.b.createdAt.getTime()),
    );
}

/** Kolik dvojic čeká na rozhodnutí — pro odkaz nad seznamem klientů. */
export async function pocetDuplicit(): Promise<number> {
  return (await najdiDuplicity()).length;
}

/** Dvojice seřazená tak, jak se ukládá do `client_not_duplicates`. */
export function seradDvojici(prvni: string, druhy: string): [string, string] {
  return prvni < druhy ? [prvni, druhy] : [druhy, prvni];
}
