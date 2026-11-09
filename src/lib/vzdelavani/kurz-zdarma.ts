import { db } from "@/lib/db";

import { KURZ_S_UKAZKOU } from "./pristup";

/**
 * Minikurz zdarma (Platforma B, Jakub 5. 11. 2026) — veřejná ukázka kurzu.
 *
 * | Kdo           | Smí                                                              |
 * | ------------- | ---------------------------------------------------------------- |
 * | nepřihlášený  | na `/ucet/kurz-zdarma/[id]` číst lekce zdarma (text a video)     |
 * | klient        | totéž, odkaz má v Kurzech u kurzu, který nemá                    |
 * | uživatel      | v CRM vidět, které lekce jsou zdarma                             |
 * | administrátor | navíc lekci zdarma zapnout a vypnout (formulář lekce)            |
 *
 * **Vydává se jen text a video lekcí zdarma.** Ostatní lekce jen názvem,
 * žádný kvíz, materiály, odškrtnutí ani data klientů — stránka je veřejná
 * (security.md, tabulka adres bez přihlášení). Pravidla jsou
 * v `pristup.ts` a jdou do dotazu.
 */

export interface LekceUkazky {
  id: string;
  title: string;
  /** `null` = lekce není zdarma, ukáže se jen název. */
  obsah: { body: string; videoUrl: string | null } | null;
}

/** Kurz s veřejnou ukázkou, nebo `null` (neexistuje / nemá lekci zdarma). */
export async function nactiKurzZdarma(courseId: string) {
  const kurz = await db.course.findFirst({
    where: { AND: [{ id: courseId }, KURZ_S_UKAZKOU] },
    select: {
      id: true,
      title: true,
      description: true,
      product: { select: { id: true, url: true, active: true } },
      lekce: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, title: true, freePreview: true, body: true, videoUrl: true },
      },
    },
  });
  if (!kurz) return null;

  return {
    id: kurz.id,
    title: kurz.title,
    description: kurz.description,
    // Koupit (jako v Kurzech klienta) jen u prodávaného produktu.
    productId: kurz.product.active ? kurz.product.id : null,
    url: kurz.product.url,
    lekce: kurz.lekce.map((lekce): LekceUkazky => ({
      id: lekce.id,
      title: lekce.title,
      // Obsah placené lekce se ze serveru vůbec nedostane, jen název.
      obsah: lekce.freePreview ? { body: lekce.body, videoUrl: lekce.videoUrl } : null,
    })),
  };
}
