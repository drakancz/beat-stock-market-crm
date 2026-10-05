"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { CHYBA_VIDEA, rozpoznejVideo } from "@/lib/vzdelavani/video";

/**
 * Články členské sekce (krok 3C, Jakub 4. 10. 2026). **Mění jen
 * administrátor**, tým vidí; klient s platným členstvím čte. Do auditu jde
 * název, ne text.
 */

export type VysledekClanku = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

const clanekSchema = z.object({
  id: ID.optional(),
  title: z.string().trim().min(1, "Napiš název článku.").max(200, "Název je příliš dlouhý."),
  body: z.string().trim().max(50_000, "Text je příliš dlouhý."),
  videoUrl: z
    .string()
    .trim()
    .max(500, "Odkaz na video je příliš dlouhý.")
    .refine((odkaz) => odkaz === "" || rozpoznejVideo(odkaz) !== null, CHYBA_VIDEA),
  zverejnit: z.enum(["ano", "ne"]),
});

function obnov() {
  revalidatePath("/vzdelavani/clenska-sekce");
  revalidatePath("/ucet/clenska-sekce");
}

export async function ulozClanek(formData: FormData): Promise<VysledekClanku> {
  const admin = await requireAdmin();

  const vstup = clanekSchema.safeParse({
    id: formData.get("id") || undefined,
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    videoUrl: formData.get("videoUrl") ?? "",
    zverejnit: formData.get("zverejnit"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, title, body, videoUrl, zverejnit } = vstup.data;
  if (!body && !videoUrl) return { ok: false, chyba: "Článek potřebuje text, video, nebo obojí." };

  const puvodni = id
    ? await db.memberPost.findFirst({
        where: { id, deletedAt: null },
        select: { publishedAt: true },
      })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Takový článek neexistuje." };
  const publishedAt = zverejnit === "ano" ? (puvodni?.publishedAt ?? new Date()) : null;

  await db.$transaction(async (tx) => {
    const data = { title, body, videoUrl: videoUrl || null, publishedAt };
    const ulozeny = id
      ? await tx.memberPost.update({ where: { id }, data, select: { id: true } })
      : await tx.memberPost.create({ data, select: { id: true } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "member_posts",
      entityId: ulozeny.id,
      action: id ? "clanek.upraven" : "clanek.zalozen",
      after: { title, zverejneno: zverejnit === "ano" },
    });
  });

  obnov();
  return { ok: true, zprava: id ? `Článek je uložený: ${title}.` : `Článek je přidaný: ${title}.` };
}

export async function smazClanek(idRaw: string): Promise<VysledekClanku> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const clanek = await db.memberPost.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!clanek) return { ok: false, chyba: "Takový článek neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.memberPost.update({ where: { id: clanek.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "member_posts",
      entityId: clanek.id,
      action: "clanek.smazan",
      before: { title: clanek.title },
    });
  });

  obnov();
  return { ok: true, zprava: `Smazáno: ${clanek.title}.` };
}
