"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { MEZE } from "@/lib/vlastni-pravidla-druhy";
import { pravidloSchema } from "@/lib/vlastni-pravidla";

/**
 * Vlastní pravidla (Fáze 5D, 2. část, Jakub 19. 10. 2026). **Skládá,
 * zapíná a maže jen administrátor** — `requireAdmin()` na prvním řádku,
 * uživatel je na stránce Pravidla jen vidí. Podmínky a akce přicházejí
 * jako JSON a ověřují se schématem i proti databázi.
 */

export type VysledekVlastnihoPravidla = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

function obnov() {
  revalidatePath("/pravidla");
}

/** Odkazy pravidla musí vést na existující věci. Vrací chybu, nebo `null`. */
async function overOdkazy(data: z.infer<typeof pravidloSchema>): Promise<string | null> {
  const stitky = [
    ...data.conditions.flatMap((p) => (p.druh === "stitek" ? [p.tagId] : [])),
    ...data.actions.flatMap((a) => (a.druh === "stitek" ? [a.tagId] : [])),
  ];
  const produkty = data.conditions.flatMap((p) => (p.druh === "koupil" ? [p.productId] : []));
  const lide = data.actions.flatMap((a) => (a.druh === "ukol" ? [a.userId] : []));
  const pole = data.conditions.flatMap((p) => (p.druh === "pole" ? [p] : []));

  const [nalezeneStitky, nalezeneProdukty, nalezeniLide, nalezenaPole] = await Promise.all([
    db.clientTag.count({ where: { id: { in: stitky }, deletedAt: null } }),
    db.product.count({ where: { id: { in: produkty } } }),
    db.user.count({ where: { id: { in: lide }, active: true, deletedAt: null } }),
    db.clientField.findMany({
      where: { id: { in: pole.map((p) => p.fieldId) }, deletedAt: null },
      select: { id: true, kind: true, options: true },
    }),
  ]);
  if (nalezeneStitky !== new Set(stitky).size) return "Takový štítek neexistuje.";
  if (nalezeneProdukty !== new Set(produkty).size) return "Takový produkt neexistuje.";
  if (nalezeniLide !== new Set(lide).size) return "Takový kolega neexistuje nebo nemá přístup.";
  for (const p of pole) {
    const definice = nalezenaPole.find((f) => f.id === p.fieldId);
    if (!definice) return "Takové vlastní pole neexistuje.";
    const povolene =
      definice.kind === "ANO_NE"
        ? ["ano", "ne"]
        : definice.kind === "VYBER"
          ? definice.options
          : [];
    if (!povolene.includes(p.hodnota)) return "Vlastní pole takovou hodnotu nemá.";
  }
  return null;
}

export async function ulozVlastniPravidlo(formData: FormData): Promise<VysledekVlastnihoPravidla> {
  const admin = await requireAdmin();

  let json: unknown;
  try {
    json = JSON.parse(String(formData.get("pravidlo") ?? ""));
  } catch {
    return { ok: false, chyba: "Neplatný požadavek." };
  }
  const id = formData.get("id") ? ID.safeParse(formData.get("id")) : null;
  if (id && !id.success) return { ok: false, chyba: "Neplatný požadavek." };
  const vstup = pravidloSchema.safeParse(json);
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const chyba = await overOdkazy(vstup.data);
  if (chyba) return { ok: false, chyba };
  const { name, conditions, actions } = vstup.data;

  if (id) {
    const puvodni = await db.customRule.findFirst({
      where: { id: id.data, deletedAt: null },
      select: { id: true },
    });
    if (!puvodni) return { ok: false, chyba: "Takové pravidlo neexistuje." };
    await db.$transaction(async (tx) => {
      await tx.customRule.update({
        where: { id: puvodni.id },
        data: { name, conditions, actions },
      });
      await zapisDoAuditu(tx, {
        userId: admin.id,
        entity: "custom_rules",
        entityId: puvodni.id,
        action: "pravidlo.zmeneno",
        after: { name, podminek: conditions.length, akci: actions.length },
      });
    });
    obnov();
    return { ok: true, zprava: `Pravidlo je uložené: ${name}.` };
  }

  const pocet = await db.customRule.count({ where: { deletedAt: null } });
  if (pocet >= MEZE.pravidel) {
    return { ok: false, chyba: `Vlastních pravidel může být nejvýš ${MEZE.pravidel}.` };
  }
  await db.$transaction(async (tx) => {
    const nove = await tx.customRule.create({
      data: { name, conditions, actions },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "custom_rules",
      entityId: nove.id,
      action: "pravidlo.zalozeno",
      after: { name, podminek: conditions.length, akci: actions.length },
    });
  });
  obnov();
  return { ok: true, zprava: `Pravidlo je založené (zatím vypnuté): ${name}.` };
}

export async function zapniVlastniPravidlo(
  idRaw: string,
  zapnoutRaw: boolean,
): Promise<VysledekVlastnihoPravidla> {
  const admin = await requireAdmin();
  const vstup = z
    .object({ id: ID, zapnout: z.boolean() })
    .safeParse({ id: idRaw, zapnout: zapnoutRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const pravidlo = await db.customRule.findFirst({
    where: { id: vstup.data.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!pravidlo) return { ok: false, chyba: "Takové pravidlo neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.customRule.update({
      where: { id: pravidlo.id },
      data: { enabled: vstup.data.zapnout },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "custom_rules",
      entityId: pravidlo.id,
      action: "pravidlo.zmeneno",
      after: { name: pravidlo.name, zapnuto: vstup.data.zapnout },
    });
  });
  obnov();
  return {
    ok: true,
    zprava: vstup.data.zapnout
      ? `Pravidlo je zapnuté: ${pravidlo.name}. Poběží s nejbližším ranním plánovačem.`
      : `Pravidlo je vypnuté: ${pravidlo.name}.`,
  };
}

export async function smazVlastniPravidlo(idRaw: string): Promise<VysledekVlastnihoPravidla> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const pravidlo = await db.customRule.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!pravidlo) return { ok: false, chyba: "Takové pravidlo neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.customRule.update({
      where: { id: pravidlo.id },
      data: { deletedAt: new Date(), enabled: false },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "custom_rules",
      entityId: pravidlo.id,
      action: "pravidlo.smazano",
      before: { name: pravidlo.name },
    });
  });
  obnov();
  return { ok: true, zprava: `Smazáno: ${pravidlo.name}.` };
}
