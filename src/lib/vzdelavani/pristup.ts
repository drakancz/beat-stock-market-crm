import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { dnesniZacatek } from "@/lib/platnost";

/**
 * Co smí klient ze vzdělávání vidět (krok 3C, Jakub 4. 10. 2026).
 *
 * **Jediné místo s pravidly přístupu** — obrazovky klientské části si je
 * nepíšou znovu a podmínka je vždy v dotazu do databáze (security.md,
 * pravidlo 3). `clientId` se bere z přihlášení (`requireKlient()`).
 *
 * - **Kurz** vidí, kdo má jeho produkt v **zaplacené**, nesmazané
 *   objednávce. Kurz je doživotní, přístup nekončí.
 * - **Členskou sekci** vidí, kdo má **právě platné** kterékoli členství
 *   (`product_validities`, konec dnes nebo později).
 * - **Webinář** podle `audience`: všichni s účtem / členové / kupci kurzu.
 *
 * Koncepty (nezveřejněné kurzy a články) a smazaný obsah klient nevidí
 * nikdy.
 */

/** Podmínka „klient má tenhle produkt zaplacený" pro dotaz na kurzy. */
export function zaplacenyProduktKlienta(clientId: string): Prisma.ProductWhereInput {
  return {
    orders: {
      some: { order: { clientId, status: "ZAPLACENO", deletedAt: null } },
    },
  };
}

/** Zveřejněné kurzy, které klient vlastní. */
export function kurzyKlienta(clientId: string): Prisma.CourseWhereInput {
  return {
    deletedAt: null,
    publishedAt: { not: null },
    product: zaplacenyProduktKlienta(clientId),
  };
}

/** Má klient právě platné nějaké členství? */
export async function maPlatneClenstvi(clientId: string): Promise<boolean> {
  const platne = await db.productValidity.findFirst({
    where: {
      clientId,
      validUntil: { gte: dnesniZacatek() },
      product: { kind: "CLENSTVI" },
    },
    select: { id: true },
  });
  return platne !== null;
}

/** Webináře, které se klientovi ukážou. */
export async function webinareKlienta(clientId: string): Promise<Prisma.WebinarWhereInput> {
  const clen = await maPlatneClenstvi(clientId);
  return {
    deletedAt: null,
    OR: [
      { audience: "VSICHNI" },
      ...(clen ? [{ audience: "CLENOVE" as const }] : []),
      { audience: "KURZ", course: kurzyKlienta(clientId) },
    ],
  };
}
