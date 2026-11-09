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
 * - **Lekci zdarma** (Platforma B) vidí kdokoli, i bez přihlášení —
 *   `LEKCE_ZDARMA`, `KURZ_S_UKAZKOU`.
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

/**
 * Ukázková lekce zdarma (Platforma B, Jakub 5. 11. 2026) — **pro každého,
 * i nepřihlášeného**: lekce označená administrátorem, nesmazaná, v kurzu,
 * který je zveřejněný, nesmazaný a s produktem mimo Smazané. Vydává se
 * z ní jen text a video (kvíz, materiály ani odškrtnutí ne).
 */
export const LEKCE_ZDARMA: Prisma.CourseLessonWhereInput = {
  freePreview: true,
  deletedAt: null,
};

/** Kurz, který má veřejnou ukázku — aspoň jednu lekci zdarma. */
export const KURZ_S_UKAZKOU: Prisma.CourseWhereInput = {
  deletedAt: null,
  publishedAt: { not: null },
  product: { deletedAt: null },
  lekce: { some: LEKCE_ZDARMA },
};

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

/**
 * Klienti, kterým se webinář ukazuje — opačný směr k `webinareKlienta()`
 * (připomínka webináře, Fáze 5C, 11. 10. 2026). Jen klienti s aktivním
 * účtem v klientské části a kartou mimo Smazané.
 */
export function klientiWebinare(webinar: {
  audience: "VSICHNI" | "CLENOVE" | "KURZ";
  course: { productId: string; deletedAt: Date | null; publishedAt: Date | null } | null;
}): Prisma.ClientWhereInput | null {
  const sUctem: Prisma.ClientWhereInput = {
    deletedAt: null,
    mergedIntoId: null,
    ucet: { passwordHash: { not: null }, revokedAt: null },
  };
  if (webinar.audience === "VSICHNI") return sUctem;
  if (webinar.audience === "CLENOVE") {
    return {
      ...sUctem,
      platnosti: {
        some: { validUntil: { gte: dnesniZacatek() }, product: { kind: "CLENSTVI" } },
      },
    };
  }
  // Kupci kurzu — jen zveřejněného a nesmazaného, jako v `kurzyKlienta()`.
  const kurz = webinar.course;
  if (!kurz || kurz.deletedAt || !kurz.publishedAt) return null;
  return {
    ...sUctem,
    orders: {
      some: {
        status: "ZAPLACENO",
        deletedAt: null,
        items: { some: { productId: kurz.productId } },
      },
    },
  };
}
