"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prectiOkamzik } from "@/lib/obdobi";
import { requireAdmin } from "@/lib/session";
import { udelOdznakyZaWebinare } from "@/lib/vzdelavani/odznaky";

/**
 * Webináře a účast na nich (krok 3C, Jakub 4. 10. 2026). **Mění jen
 * administrátor** (`requireAdmin()`), tým vidí. U každého termínu se
 * vybere, komu se ukáže: všichni s účtem, členové, nebo kupci kurzu.
 * Účast zapisuje administrátor ručně, dokud nebude napojený WebinarJam.
 */

export type VysledekWebinare =
  { ok: true; zprava: string; id?: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

function obnov(webinarId?: string) {
  revalidatePath("/vzdelavani/webinare");
  if (webinarId) revalidatePath(`/vzdelavani/webinare/${webinarId}`);
  revalidatePath("/ucet/webinare");
}

const webinarSchema = z
  .object({
    id: ID.optional(),
    title: z.string().trim().min(1, "Napiš název webináře.").max(200, "Název je příliš dlouhý."),
    description: z.string().trim().max(2000, "Popis je příliš dlouhý."),
    startsAt: z.string().trim().max(20),
    durationMinutes: z.coerce
      .number({ error: "Délka musí být číslo." })
      .int("Délka musí být celé číslo minut.")
      .min(10, "Webinář trvá aspoň 10 minut.")
      .max(600, "Webinář trvá nejvýš 10 hodin."),
    joinUrl: z
      .string()
      .trim()
      .max(500, "Odkaz je příliš dlouhý.")
      .refine((odkaz) => odkaz === "" || /^https:\/\/[^\s]+$/.test(odkaz), {
        message: "Odkaz na připojení musí začínat https://.",
      }),
    audience: z.enum(["VSICHNI", "CLENOVE", "KURZ"], { error: "Vyber, komu se webinář ukáže." }),
    courseId: z.string().trim().max(64),
  })
  .refine((data) => data.audience !== "KURZ" || data.courseId !== "", {
    message: "Vyber kurz, jehož kupcům se webinář ukáže.",
  });

export async function ulozWebinar(formData: FormData): Promise<VysledekWebinare> {
  const admin = await requireAdmin();

  const vstup = webinarSchema.safeParse({
    id: formData.get("id") || undefined,
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    startsAt: formData.get("startsAt") ?? "",
    durationMinutes: formData.get("durationMinutes") ?? "",
    joinUrl: formData.get("joinUrl") ?? "",
    audience: formData.get("audience"),
    courseId: formData.get("courseId") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, title, description, durationMinutes, joinUrl, audience } = vstup.data;

  const startsAt = prectiOkamzik(vstup.data.startsAt);
  if (!startsAt) return { ok: false, chyba: "Zadej datum a čas začátku." };

  const courseId = audience === "KURZ" ? vstup.data.courseId : null;
  if (courseId) {
    const kurz = await db.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true },
    });
    if (!kurz) return { ok: false, chyba: "Takový kurz neexistuje." };
  }

  if (id) {
    const existuje = await db.webinar.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existuje) return { ok: false, chyba: "Takový webinář neexistuje." };
  }

  const data = {
    title,
    description: description || null,
    startsAt,
    durationMinutes,
    joinUrl: joinUrl || null,
    audience,
    courseId,
  };

  const webinar = await db.$transaction(async (tx) => {
    const ulozeny = id
      ? await tx.webinar.update({ where: { id }, data, select: { id: true } })
      : await tx.webinar.create({ data, select: { id: true } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "webinars",
      entityId: ulozeny.id,
      action: id ? "webinar.upraven" : "webinar.zalozen",
      after: { title, startsAt: startsAt.toISOString(), audience },
    });
    return ulozeny;
  });

  obnov(webinar.id);
  return {
    ok: true,
    id: webinar.id,
    zprava: id ? `Webinář je uložený: ${title}.` : `Webinář je naplánovaný: ${title}.`,
  };
}

export async function smazWebinar(idRaw: string): Promise<VysledekWebinare> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const webinar = await db.webinar.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!webinar) return { ok: false, chyba: "Takový webinář neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.webinar.update({ where: { id: webinar.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "webinars",
      entityId: webinar.id,
      action: "webinar.smazan",
      before: { title: webinar.title },
    });
  });

  obnov(webinar.id);
  return { ok: true, zprava: `Smazáno: ${webinar.title}.` };
}

/* ---------- Účast ---------- */

export async function zapisUcast(formData: FormData): Promise<VysledekWebinare> {
  const admin = await requireAdmin();
  const vstup = z
    .object({ webinarId: ID, clientId: z.string().trim().min(1, "Vyber klienta.").max(64) })
    .safeParse({ webinarId: formData.get("webinarId"), clientId: formData.get("clientId") ?? "" });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const [webinar, klient] = await Promise.all([
    db.webinar.findFirst({
      where: { id: vstup.data.webinarId, deletedAt: null },
      select: { id: true, title: true },
    }),
    db.client.findFirst({
      where: { id: vstup.data.clientId, deletedAt: null, mergedIntoId: null },
      select: { id: true, name: true },
    }),
  ]);
  if (!webinar) return { ok: false, chyba: "Takový webinář neexistuje." };
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const uz = await db.webinarAttendance.findUnique({
    where: { webinarId_clientId: { webinarId: webinar.id, clientId: klient.id } },
    select: { id: true },
  });
  if (uz) return { ok: true, zprava: `Účast už je zapsaná: ${klient.name}.` };

  await db.$transaction(async (tx) => {
    await tx.webinarAttendance.create({
      data: { webinarId: webinar.id, clientId: klient.id, markedById: admin.id },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "webinars",
      entityId: webinar.id,
      action: "webinar.ucast-zapsana",
      after: { webinar: webinar.title, klient: klient.name },
    });
  });

  await udelOdznakyZaWebinare(klient.id);

  obnov(webinar.id);
  revalidatePath(`/klienti/${klient.id}`);
  return { ok: true, zprava: `Účast je zapsaná: ${klient.name}.` };
}

export async function zrusUcast(
  webinarIdRaw: string,
  clientIdRaw: string,
): Promise<VysledekWebinare> {
  const admin = await requireAdmin();
  const vstup = z
    .object({ webinarId: ID, clientId: ID })
    .safeParse({ webinarId: webinarIdRaw, clientId: clientIdRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const ucast = await db.webinarAttendance.findUnique({
    where: { webinarId_clientId: vstup.data },
    select: { id: true, webinar: { select: { title: true } }, client: { select: { name: true } } },
  });
  if (!ucast) return { ok: false, chyba: "Taková účast není zapsaná." };

  await db.$transaction(async (tx) => {
    await tx.webinarAttendance.delete({ where: { id: ucast.id } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "webinars",
      entityId: vstup.data.webinarId,
      action: "webinar.ucast-zrusena",
      before: { webinar: ucast.webinar.title, klient: ucast.client.name },
    });
  });

  obnov(vstup.data.webinarId);
  revalidatePath(`/klienti/${vstup.data.clientId}`);
  return { ok: true, zprava: `Účast je zrušená: ${ucast.client.name}.` };
}
