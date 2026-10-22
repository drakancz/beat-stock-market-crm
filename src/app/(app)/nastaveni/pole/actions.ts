"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import {
  DRUHY_POLI,
  MAX_MOZNOST,
  MAX_MOZNOSTI,
  MAX_NAZEV,
  MAX_POLI,
} from "@/lib/vlastni-pole-druhy";

/**
 * Nastavení → Vlastní pole (Fáze 5B, Jakub 18. 10. 2026).
 *
 * **Seznam polí spravuje jen administrátor** — `requireAdmin()` na prvním
 * řádku každé akce. Hodnoty u klientů vyplňuje každý přihlášený
 * (`klienti/pole-actions.ts`). Každá změna jde do auditu.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);
const NAZEV = z
  .string()
  .trim()
  .min(1, "Napiš název pole.")
  .max(MAX_NAZEV, `Název pole může mít nejvýš ${MAX_NAZEV} znaků.`);

function obnov() {
  revalidatePath("/nastaveni/pole");
  revalidatePath("/klienti");
}

/** Možnosti výběru — jedna na řádek, bez prázdných a opakování. */
function prectiMoznosti(text: string): string[] | { chyba: string } {
  const moznosti = [...new Set(text.split(/\r?\n/).map((radek) => radek.trim()))].filter(Boolean);
  if (moznosti.length < 2)
    return { chyba: "Výběr potřebuje aspoň dvě možnosti (každou na řádek)." };
  if (moznosti.length > MAX_MOZNOSTI) return { chyba: `Nejvýš ${MAX_MOZNOSTI} možností.` };
  const dlouha = moznosti.find((moznost) => moznost.length > MAX_MOZNOST || moznost.includes(":"));
  if (dlouha) {
    return { chyba: `Možnost „${dlouha.slice(0, 20)}…“ je moc dlouhá nebo obsahuje dvojtečku.` };
  }
  return moznosti;
}

export async function ulozPole(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = z
    .object({
      id: ID.optional(),
      name: NAZEV,
      kind: z.enum(DRUHY_POLI, { error: "Vyber druh pole." }).optional(),
      options: z.string().max(5_000),
    })
    .safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name") ?? "",
      kind: formData.get("kind") || undefined,
      options: formData.get("options") ?? "",
    });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, name } = vstup.data;

  const puvodni = id
    ? await db.clientField.findFirst({
        where: { id, deletedAt: null },
        select: { name: true, kind: true, options: true },
      })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Takové pole neexistuje." };
  // Druh se po založení nemění — hodnoty u klientů by přestaly sedět.
  const kind = puvodni?.kind ?? vstup.data.kind;
  if (!kind) return { ok: false, chyba: "Vyber druh pole." };

  let options: string[] = [];
  if (kind === "VYBER") {
    const moznosti = prectiMoznosti(vstup.data.options);
    if (!Array.isArray(moznosti)) return { ok: false, chyba: moznosti.chyba };
    options = moznosti;
  }

  const stejne = await db.clientField.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { id: { not: id } } : {}),
    },
    select: { id: true },
  });
  if (stejne) return { ok: false, chyba: `Pole ${name} už v seznamu je.` };

  if (!id && (await db.clientField.count({ where: { deletedAt: null } })) >= MAX_POLI) {
    return { ok: false, chyba: `Vlastních polí může být nejvýš ${MAX_POLI}.` };
  }

  await db.$transaction(async (tx) => {
    let poleId = id;
    if (id) {
      await tx.clientField.update({ where: { id }, data: { name, options } });
    } else {
      const posledni = await tx.clientField.aggregate({
        where: { deletedAt: null },
        _max: { position: true },
      });
      const nove = await tx.clientField.create({
        data: { name, kind, options, position: (posledni._max.position ?? 0) + 1 },
        select: { id: true },
      });
      poleId = nove.id;
    }
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_fields",
      entityId: poleId!,
      action: id ? "pole.upraveno" : "pole.zalozeno",
      before: puvodni ? { nazev: puvodni.name, moznosti: puvodni.options } : undefined,
      after: { nazev: name, druh: kind, moznosti: options },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: id ? `Pole je uložené: ${name}.` : `Pole je založené: ${name}.`,
  };
}

/** Posune pole v pořadí o jedno nahoru nebo dolů. */
export async function posunPole(idRaw: string, smerRaw: "nahoru" | "dolu"): Promise<Vysledek> {
  await requireAdmin();
  const vstup = z
    .object({ id: ID, smer: z.enum(["nahoru", "dolu"]) })
    .safeParse({ id: idRaw, smer: smerRaw });
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const pole = await db.clientField.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = pole.findIndex((p) => p.id === vstup.data.id);
  const soused = index + (vstup.data.smer === "nahoru" ? -1 : 1);
  if (index === -1 || soused < 0 || soused >= pole.length) return { ok: true, zprava: "" };

  const poradi = pole.map((p) => p.id);
  [poradi[index], poradi[soused]] = [poradi[soused]!, poradi[index]!];
  await db.$transaction(
    poradi.map((poleId, i) =>
      db.clientField.update({ where: { id: poleId }, data: { position: i + 1 } }),
    ),
  );
  obnov();
  return { ok: true, zprava: "" };
}

export async function smazPole(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const vstup = ID.safeParse(id);
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const pole = await db.clientField.findFirst({
    where: { id: vstup.data, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!pole) return { ok: false, chyba: "Takové pole neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.clientField.update({ where: { id: pole.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_fields",
      entityId: pole.id,
      action: "pole.smazano",
      after: { nazev: pole.name },
    });
  });

  obnov();
  return { ok: true, zprava: `Smazáno: ${pole.name}.` };
}
