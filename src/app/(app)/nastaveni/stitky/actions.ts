"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";

/**
 * Nastavení → Štítky (Fáze 5B, Jakub 11. 10. 2026).
 *
 * **Seznam štítků spravuje jen administrátor** — `requireAdmin()` je první
 * řádek každé akce. Klientům štítky přidává každý přihlášený
 * (`klienti/stitky-actions.ts`). Každá změna jde do auditu (pravidlo 7).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);
const BARVA = z.enum(["ZAKLADNI", "ZNACKA", "ZELENA", "JANTAR", "CERVENA"], {
  error: "Vyber barvu štítku.",
});
const NAZEV = z
  .string()
  .trim()
  .min(1, "Napiš název štítku.")
  .max(40, "Název štítku může mít nejvýš 40 znaků.");

function obnov() {
  revalidatePath("/nastaveni/stitky");
  revalidatePath("/klienti");
}

/** Stejný název by ve výběru nešel rozlišit — hlídá se i proti smazaným. */
async function kolize(nazev: string, krome?: string) {
  return db.clientTag.findFirst({
    where: {
      name: { equals: nazev, mode: "insensitive" },
      ...(krome ? { id: { not: krome } } : {}),
    },
    select: { name: true, deletedAt: true },
  });
}

export async function ulozStitek(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = z.object({ id: ID.optional(), name: NAZEV, color: BARVA }).safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    color: formData.get("color"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, name, color } = vstup.data;

  const stejny = await kolize(name, id);
  if (stejny) {
    return {
      ok: false,
      chyba: stejny.deletedAt
        ? `Štítek ${stejny.name} byl smazaný — vyber jiný název.`
        : `Štítek ${stejny.name} už v seznamu je.`,
    };
  }

  const puvodni = id
    ? await db.clientTag.findFirst({
        where: { id, deletedAt: null },
        select: { name: true, color: true },
      })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Takový štítek neexistuje." };

  await db.$transaction(async (tx) => {
    const ulozeny = id
      ? await tx.clientTag.update({ where: { id }, data: { name, color }, select: { id: true } })
      : await tx.clientTag.create({ data: { name, color }, select: { id: true } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_tags",
      entityId: ulozeny.id,
      action: id ? "stitek.upraven" : "stitek.zalozen",
      ...(puvodni ? { before: { name: puvodni.name, color: puvodni.color } } : {}),
      after: { name, color },
    });
  });

  obnov();
  return { ok: true, zprava: id ? `Štítek je uložený: ${name}.` : `Štítek je založený: ${name}.` };
}

/** Smaže štítek (`deletedAt`) — zmizí u všech klientů. Potvrzuje se v okně. */
export async function smazStitek(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const stitek = await db.clientTag.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, name: true, _count: { select: { klienti: true } } },
  });
  if (!stitek) return { ok: false, chyba: "Takový štítek neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.clientTag.update({ where: { id: stitek.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_tags",
      entityId: stitek.id,
      action: "stitek.smazan",
      before: { name: stitek.name, klientu: stitek._count.klienti },
    });
  });

  obnov();
  return {
    ok: true,
    zprava:
      stitek._count.klienti > 0
        ? `Smazáno: ${stitek.name}. Štítek zmizel u ${pocet(stitek._count.klienti, "klienta", "klientů", "klientů")}.`
        : `Smazáno: ${stitek.name}.`,
  };
}
