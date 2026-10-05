"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { CHYBA_VIDEA, rozpoznejVideo } from "@/lib/vzdelavani/video";

/**
 * Kurzy a lekce (krok 3C, Jakub 4. 10. 2026).
 *
 * **Mění jen administrátor** — `requireAdmin()` je první řádek každé akce;
 * tým obsah jen vidí. Do auditu jde název, ne text lekce.
 *
 * Kurz patří k produktu druhu Kurz v ceníku; na jeden produkt nejvýš jeden
 * nesmazaný kurz. Smazání vyplní `deletedAt` (do Smazaných nechodí).
 */

export type VysledekVzdelavani =
  { ok: true; zprava: string; id?: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

function obnov(kurzId?: string) {
  revalidatePath("/vzdelavani");
  if (kurzId) revalidatePath(`/vzdelavani/kurzy/${kurzId}`);
  revalidatePath("/ucet/kurzy");
}

/* ---------- Kurz ---------- */

const kurzSchema = z.object({
  id: ID.optional(),
  productId: ID,
  title: z.string().trim().min(1, "Napiš název kurzu.").max(200, "Název je příliš dlouhý."),
  description: z.string().trim().max(2000, "Popis je příliš dlouhý."),
  zverejnit: z.enum(["ano", "ne"]),
});

export async function ulozKurz(formData: FormData): Promise<VysledekVzdelavani> {
  const admin = await requireAdmin();

  const vstup = kurzSchema.safeParse({
    id: formData.get("id") || undefined,
    productId: formData.get("productId"),
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    zverejnit: formData.get("zverejnit"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, productId, title, description, zverejnit } = vstup.data;

  const produkt = await db.product.findFirst({
    where: { id: productId, deletedAt: null, kind: "KURZ" },
    select: { id: true },
  });
  if (!produkt) return { ok: false, chyba: "Vyber kurz z ceníku." };

  const obsazeny = await db.course.findFirst({
    where: { productId, deletedAt: null, ...(id ? { NOT: { id } } : {}) },
    select: { title: true },
  });
  if (obsazeny) {
    return { ok: false, chyba: `K tomuhle produktu už kurz je: ${obsazeny.title}.` };
  }

  const puvodni = id
    ? await db.course.findFirst({ where: { id, deletedAt: null }, select: { publishedAt: true } })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Takový kurz neexistuje." };

  // Zveřejnění si pamatuje první datum; koncept ho zahodí.
  const publishedAt = zverejnit === "ano" ? (puvodni?.publishedAt ?? new Date()) : null;

  const kurz = await db.$transaction(async (tx) => {
    const ulozeny = id
      ? await tx.course.update({
          where: { id },
          data: { productId, title, description: description || null, publishedAt },
          select: { id: true },
        })
      : await tx.course.create({
          data: { productId, title, description: description || null, publishedAt },
          select: { id: true },
        });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "courses",
      entityId: ulozeny.id,
      action: id ? "kurz.upraven" : "kurz.zalozen",
      after: { title, zverejneno: zverejnit === "ano" },
    });
    return ulozeny;
  });

  obnov(kurz.id);
  return {
    ok: true,
    id: kurz.id,
    zprava: id ? `Kurz je uložený: ${title}.` : `Kurz je založený: ${title}.`,
  };
}

export async function smazKurz(idRaw: string): Promise<VysledekVzdelavani> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const kurz = await db.course.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!kurz) return { ok: false, chyba: "Takový kurz neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.course.update({ where: { id: kurz.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "courses",
      entityId: kurz.id,
      action: "kurz.smazan",
      before: { title: kurz.title },
    });
  });

  obnov(kurz.id);
  return { ok: true, zprava: `Smazáno: ${kurz.title}.` };
}

/* ---------- Lekce ---------- */

const lekceSchema = z.object({
  id: ID.optional(),
  courseId: ID,
  title: z.string().trim().min(1, "Napiš název lekce.").max(200, "Název je příliš dlouhý."),
  body: z.string().trim().max(50_000, "Text lekce je příliš dlouhý."),
  videoUrl: z
    .string()
    .trim()
    .max(500, "Odkaz na video je příliš dlouhý.")
    .refine((odkaz) => odkaz === "" || rozpoznejVideo(odkaz) !== null, CHYBA_VIDEA),
});

export async function ulozLekci(formData: FormData): Promise<VysledekVzdelavani> {
  const admin = await requireAdmin();

  const vstup = lekceSchema.safeParse({
    id: formData.get("id") || undefined,
    courseId: formData.get("courseId"),
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    videoUrl: formData.get("videoUrl") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, courseId, title, body, videoUrl } = vstup.data;
  if (!body && !videoUrl) return { ok: false, chyba: "Lekce potřebuje text, video, nebo obojí." };

  const kurz = await db.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!kurz) return { ok: false, chyba: "Takový kurz neexistuje." };

  if (id) {
    const lekce = await db.courseLesson.findFirst({
      where: { id, courseId, deletedAt: null },
      select: { id: true },
    });
    if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };
  }

  await db.$transaction(async (tx) => {
    let lekceId = id;
    if (id) {
      await tx.courseLesson.update({
        where: { id },
        data: { title, body, videoUrl: videoUrl || null },
      });
    } else {
      const posledni = await tx.courseLesson.aggregate({
        where: { courseId, deletedAt: null },
        _max: { position: true },
      });
      const nova = await tx.courseLesson.create({
        data: {
          courseId,
          title,
          body,
          videoUrl: videoUrl || null,
          position: (posledni._max.position ?? 0) + 1,
        },
        select: { id: true },
      });
      lekceId = nova.id;
    }
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "course_lessons",
      entityId: lekceId!,
      action: id ? "lekce.upravena" : "lekce.zalozena",
      after: { title, kurz: courseId },
    });
  });

  obnov(courseId);
  return { ok: true, zprava: id ? `Lekce je uložená: ${title}.` : `Lekce je přidaná: ${title}.` };
}

export async function smazLekci(idRaw: string): Promise<VysledekVzdelavani> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const lekce = await db.courseLesson.findFirst({
    where: { id: id.data, deletedAt: null, course: { deletedAt: null } },
    select: { id: true, title: true, courseId: true },
  });
  if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.courseLesson.update({ where: { id: lekce.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "course_lessons",
      entityId: lekce.id,
      action: "lekce.smazana",
      before: { title: lekce.title, kurz: lekce.courseId },
    });
  });

  obnov(lekce.courseId);
  return { ok: true, zprava: `Smazáno: ${lekce.title}.` };
}

/** Posune lekci o jedno místo nahoru nebo dolů (prohodí pořadí se sousedem). */
export async function posunLekci(idRaw: string, smerRaw: string): Promise<VysledekVzdelavani> {
  await requireAdmin();
  const id = ID.safeParse(idRaw);
  const smer = z.enum(["nahoru", "dolu"]).safeParse(smerRaw);
  if (!id.success || !smer.success) return { ok: false, chyba: "Neplatný požadavek." };

  const lekce = await db.courseLesson.findFirst({
    where: { id: id.data, deletedAt: null, course: { deletedAt: null } },
    select: { id: true, courseId: true, position: true },
  });
  if (!lekce) return { ok: false, chyba: "Taková lekce neexistuje." };

  const soused = await db.courseLesson.findFirst({
    where: {
      courseId: lekce.courseId,
      deletedAt: null,
      position: smer.data === "nahoru" ? { lt: lekce.position } : { gt: lekce.position },
    },
    orderBy: { position: smer.data === "nahoru" ? "desc" : "asc" },
    select: { id: true, position: true },
  });
  if (!soused) return { ok: true, zprava: "Lekce už je na kraji." };

  await db.$transaction([
    db.courseLesson.update({ where: { id: lekce.id }, data: { position: soused.position } }),
    db.courseLesson.update({ where: { id: soused.id }, data: { position: lekce.position } }),
  ]);

  obnov(lekce.courseId);
  return { ok: true, zprava: "Pořadí je změněné." };
}
