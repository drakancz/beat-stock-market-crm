"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireKlient } from "@/lib/klient/sezeni";
import { udelOdznakyZaLekce } from "@/lib/vzdelavani/odznaky";
import { kurzyKlienta } from "@/lib/vzdelavani/pristup";

/**
 * Klient si označí lekci jako hotovou, nebo to vrátí (krok 3C).
 *
 * **Jen vlastní postup a jen v kurzu, který má zaplacený** — `clientId`
 * z přihlášení, lekce se hledá s podmínkou `kurzyKlienta()`. Do auditu se
 * to nepíše, je to klientův zápisník, ne změna údajů.
 */
export type VysledekLekce = { ok: true } | { ok: false; chyba: string };

export async function oznacLekci(lekceIdRaw: string, hotovoRaw: boolean): Promise<VysledekLekce> {
  const klient = await requireKlient();

  const vstup = z
    .object({ lekceId: z.string().trim().min(1).max(64), hotovo: z.boolean() })
    .safeParse({ lekceId: lekceIdRaw, hotovo: hotovoRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const lekce = await db.courseLesson.findFirst({
    where: { id: vstup.data.lekceId, deletedAt: null, course: kurzyKlienta(klient.clientId) },
    select: { id: true, courseId: true },
  });
  if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };

  if (vstup.data.hotovo) {
    await db.lessonProgress.upsert({
      where: { clientId_lessonId: { clientId: klient.clientId, lessonId: lekce.id } },
      create: { clientId: klient.clientId, lessonId: lekce.id },
      update: {},
    });
  } else {
    await db.lessonProgress.deleteMany({
      where: { clientId: klient.clientId, lessonId: lekce.id },
    });
  }

  // Odznaky za lekce (3C) — při vrácení lekce se nic neodebírá.
  if (vstup.data.hotovo) await udelOdznakyZaLekce(klient.clientId, lekce.courseId);

  revalidatePath("/ucet");
  revalidatePath("/ucet/kurzy");
  revalidatePath(`/ucet/kurzy/${lekce.courseId}`);
  revalidatePath(`/ucet/lekce/${lekce.id}`);
  return { ok: true };
}
