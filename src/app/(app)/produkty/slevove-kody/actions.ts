"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { denSchema } from "@/lib/obdobi";
import { requireAdmin } from "@/lib/session";
import { kodSchema } from "@/lib/slevove-kody";

/**
 * Produkty → Slevové kódy (Fáze 5A, Jakub 14. 10. 2026).
 *
 * **Vidí každý přihlášený, zakládá, mění a maže jen administrátor** —
 * `requireAdmin()` je první řádek každé akce, stejně jako u ceníku. Každá
 * změna jde do auditu ve stejné transakci (pravidlo 7).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

/** Číslo z formuláře, česky s čárkou a mezerami. Prázdné = `null`. */
const cisloZFormulare = z
  .string()
  .trim()
  .transform((text) => (text === "" ? null : Number(text.replace(/\s/g, "").replace(",", "."))));

const kodFormSchema = z
  .object({
    id: ID.optional(),
    code: kodSchema,
    kind: z.enum(["PROCENTA", "CASTKA"], {
      error: "Vyber, jestli je sleva v procentech, nebo v korunách.",
    }),
    value: cisloZFormulare.pipe(
      z
        .number({ error: "Výše slevy musí být číslo." })
        .positive("Výše slevy musí být větší než nula.")
        .max(10_000_000, "Výše slevy je nesmyslně vysoká."),
    ),
    note: z
      .string()
      .trim()
      .max(200, "Poznámka může mít nejvýš 200 znaků.")
      .transform((text) => text || null),
    validFrom: z.union([z.literal(""), denSchema]).transform((den) => den || null),
    validTo: z.union([z.literal(""), denSchema]).transform((den) => den || null),
    maxUses: cisloZFormulare.pipe(
      z
        .number({ error: "Počet použití musí být celé číslo." })
        .int("Počet použití musí být celé číslo.")
        .min(1, "Počet použití musí být aspoň 1. Bez omezení nech pole prázdné.")
        .max(1_000_000, "Počet použití je nesmyslně vysoký.")
        .nullable(),
    ),
    oncePerClient: z.boolean(),
    produkty: z.array(ID).max(200),
    /** Doporučitel, kterému kód patří (5A, 15. 10. 2026). Prázdné = nikomu. */
    referrerId: z.union([z.literal(""), ID]).transform((id) => id || null),
  })
  .refine((kod) => kod.kind !== "PROCENTA" || kod.value <= 100, {
    message: "Sleva v procentech může být nejvýš 100 %.",
    path: ["value"],
  })
  .refine((kod) => !kod.validFrom || !kod.validTo || kod.validFrom <= kod.validTo, {
    message: "Platnost do musí být stejný nebo pozdější den než platnost od.",
    path: ["validTo"],
  });

function obnov() {
  revalidatePath("/produkty/slevove-kody");
  revalidatePath("/produkty/doporucitele");
  revalidatePath("/smazane");
}

export async function ulozKod(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = kodFormSchema.safeParse({
    id: formData.get("id") || undefined,
    code: formData.get("code") ?? "",
    kind: formData.get("kind"),
    value: formData.get("value") ?? "",
    note: formData.get("note") ?? "",
    validFrom: formData.get("validFrom") ?? "",
    validTo: formData.get("validTo") ?? "",
    maxUses: formData.get("maxUses") ?? "",
    oncePerClient: formData.get("oncePerClient") === "on",
    produkty: formData.getAll("produkty"),
    referrerId: formData.get("referrerId") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, produkty, ...data } = vstup.data;

  // Kód je jedinečný i proti smazaným — ať jde ten z koše vždycky vrátit.
  const stejny = await db.discountCode.findFirst({
    where: { code: data.code, ...(id ? { id: { not: id } } : {}) },
    select: { code: true, deletedAt: true },
  });
  if (stejny) {
    return {
      ok: false,
      chyba: stejny.deletedAt
        ? `Kód ${stejny.code} je ve Smazaných — obnov ho, nebo vyber jiný.`
        : `Kód ${stejny.code} už existuje.`,
    };
  }

  // Jen produkty, které v ceníku opravdu jsou.
  const platne = await db.product.findMany({
    where: { id: { in: produkty }, deletedAt: null },
    select: { id: true },
  });
  if (platne.length !== new Set(produkty).size) {
    return { ok: false, chyba: "Některý z vybraných produktů už v ceníku není." };
  }

  if (data.referrerId) {
    const doporucitel = await db.referrer.findFirst({
      where: { id: data.referrerId, deletedAt: null },
      select: { id: true },
    });
    if (!doporucitel) return { ok: false, chyba: "Takový doporučitel neexistuje." };
  }

  const puvodni = id
    ? await db.discountCode.findFirst({
        where: { id, deletedAt: null },
        select: {
          code: true,
          kind: true,
          value: true,
          validFrom: true,
          validTo: true,
          maxUses: true,
          oncePerClient: true,
          referrerId: true,
        },
      })
    : null;
  if (id && !puvodni) return { ok: false, chyba: "Takový slevový kód neexistuje." };

  const zaznam = {
    ...data,
    produkty: {
      ...(id ? { deleteMany: {} } : {}),
      create: platne.map((produkt) => ({ productId: produkt.id })),
    },
  };

  await db.$transaction(async (tx) => {
    const ulozeny = id
      ? await tx.discountCode.update({ where: { id }, data: zaznam, select: { id: true } })
      : await tx.discountCode.create({ data: zaznam, select: { id: true } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "discount_codes",
      entityId: ulozeny.id,
      action: id ? "slevovy-kod.upraven" : "slevovy-kod.zalozen",
      ...(puvodni ? { before: { ...puvodni, value: puvodni.value.toNumber() } } : {}),
      after: { ...data, produktu: platne.length },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: id ? `Kód je uložený: ${data.code}.` : `Kód je založený: ${data.code}.`,
  };
}

/** Smaže kód do koše Smazané. Objednávky s ním si slevu nechají. */
export async function smazKod(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Takový slevový kód neexistuje." };

  const kod = await db.discountCode.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, code: true, _count: { select: { objednavky: true } } },
  });
  if (!kod) return { ok: false, chyba: "Takový slevový kód neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.discountCode.update({ where: { id: kod.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "discount_codes",
      entityId: kod.id,
      action: "slevovy-kod.do-kose",
      before: { code: kod.code, objednavek: kod._count.objednavky },
    });
  });

  obnov();
  return { ok: true, zprava: `Smazáno: ${kod.code}. Landing Page ho už nepřijme.` };
}
