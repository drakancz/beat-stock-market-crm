"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { MAX_NAZEV_SABLONY, MAX_PREDMET, MAX_TEXT } from "@/lib/email-z-karty";
import { requireAdmin } from "@/lib/session";

/**
 * Nastavení → Šablony e-mailů (Fáze 5D, Jakub 5. 11. 2026).
 *
 * **Zakládá, mění a maže jen administrátor** — `requireAdmin()` je první
 * řádek každé akce (nepovolaný dostane 404). Použít šablonu v okně
 * Poslat email smí každý přihlášený. Do auditu jde jen název šablony,
 * ne její text.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

const sablonaSchema = z.object({
  id: ID.optional(),
  name: z
    .string()
    .trim()
    .min(1, "Napiš název šablony.")
    .max(MAX_NAZEV_SABLONY, `Název může mít nejvýš ${MAX_NAZEV_SABLONY} znaků.`),
  subject: z
    .string()
    .trim()
    .min(1, "Napiš předmět e-mailu.")
    .max(MAX_PREDMET, `Předmět může mít nejvýš ${MAX_PREDMET} znaků.`),
  body: z
    .string()
    .trim()
    .min(1, "Napiš text e-mailu.")
    .max(MAX_TEXT, `Text může mít nejvýš ${MAX_TEXT} znaků.`),
});

function obnov() {
  revalidatePath("/nastaveni/sablony");
  revalidatePath("/klienti", "layout");
}

export async function ulozSablonu(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = sablonaSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, name, subject, body } = vstup.data;

  // Dvě šablony stejného jména by ve výběru nešly rozlišit.
  const stejna = await db.emailTemplate.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { id: { not: id } } : {}),
    },
    select: { name: true },
  });
  if (stejna) return { ok: false, chyba: `Šablona ${stejna.name} už v seznamu je.` };

  const puvodni = id
    ? await db.emailTemplate.findFirst({ where: { id, deletedAt: null }, select: { name: true } })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Taková šablona neexistuje." };

  await db.$transaction(async (tx) => {
    const ulozena = id
      ? await tx.emailTemplate.update({
          where: { id },
          data: { name, subject, body },
          select: { id: true },
        })
      : await tx.emailTemplate.create({ data: { name, subject, body }, select: { id: true } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "email_templates",
      entityId: ulozena.id,
      action: id ? "sablona-emailu.upravena" : "sablona-emailu.zalozena",
      ...(puvodni ? { before: { name: puvodni.name } } : {}),
      after: { name },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: id ? `Šablona je uložená: ${name}.` : `Šablona je založená: ${name}.`,
  };
}

/** Smaže šablonu (`deletedAt`). Odeslané e-maily zůstávají. Potvrzuje se v okně. */
export async function smazSablonu(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const sablona = await db.emailTemplate.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!sablona) return { ok: false, chyba: "Taková šablona neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.emailTemplate.update({ where: { id: sablona.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "email_templates",
      entityId: sablona.id,
      action: "sablona-emailu.smazana",
      before: { name: sablona.name },
    });
  });

  obnov();
  return { ok: true, zprava: `Smazáno: ${sablona.name}.` };
}
