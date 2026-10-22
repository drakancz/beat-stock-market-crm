"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { POPIS_PRAVIDLA, PRAVIDLA } from "@/lib/pravidla-druhy";
import { requireAdmin } from "@/lib/session";

/**
 * Uložení pravidla „když X, udělej Y“ (Fáze 5D, Jakub 18. 10. 2026).
 * **Jen administrátor** — `requireAdmin()` na prvním řádku, uživatel stránku
 * jen vidí. Zapnuté pravidlo musí mít vyplněno, co potřebuje.
 */

export type VysledekPravidla = { ok: true; zprava: string } | { ok: false; chyba: string };

/** Prázdná volba ve výběru („nikdo“, „žádný“) se posílá jako tahle hodnota. */
const NIC = "nic";

/** Nejvíc řádků produkt → štítek u pravidla Zaplaceno → štítek. */
const MAX_DVOJIC = 50;

const volba = z
  .string()
  .trim()
  .max(64)
  .transform((hodnota) => (hodnota === "" || hodnota === NIC ? null : hodnota));

const vstupSchema = z.object({
  id: z.enum(PRAVIDLA),
  enabled: z.enum(["on"]).nullable(),
  // Zaplaceno → štítek: řádky produkt → štítek (18. 10. 2026), prázdné se přeskočí.
  produkty: z.array(volba).max(MAX_DVOJIC, `Nejvýš ${MAX_DVOJIC} řádků.`),
  stitky: z.array(volba).max(MAX_DVOJIC, `Nejvýš ${MAX_DVOJIC} řádků.`),
  messageTitle: z.string().trim().max(80, "Nadpis zprávy je příliš dlouhý (nejvýš 80 znaků)."),
  messageText: z.string().trim().max(1000, "Text zprávy je příliš dlouhý (nejvýš 1000 znaků)."),
});

export async function ulozPravidlo(formData: FormData): Promise<VysledekPravidla> {
  const admin = await requireAdmin();

  const vstup = vstupSchema.safeParse({
    id: formData.get("id"),
    enabled: formData.get("enabled"),
    produkty: formData.getAll("productId").map(String),
    stitky: formData.getAll("tagId").map(String),
    messageTitle: formData.get("messageTitle") ?? "",
    messageText: formData.get("messageText") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, messageTitle, messageText } = vstup.data;
  const zapnout = vstup.data.enabled === "on";

  const predtim = await db.automationRule.findUnique({
    where: { id },
    select: {
      enabled: true,
      messageTitle: true,
      messageText: true,
    },
  });
  if (!predtim) return { ok: false, chyba: "Takové pravidlo neexistuje." };

  // Co které pravidlo potřebuje — jen to se u něj mění.
  const data: {
    enabled: boolean;
    messageTitle?: string | null;
    messageText?: string | null;
  } = { enabled: zapnout };

  if (id === "nechodi-zprava") {
    if (zapnout && (!messageTitle || !messageText)) {
      return { ok: false, chyba: "Zpráva potřebuje nadpis i text." };
    }
    data.messageTitle = messageTitle || null;
    data.messageText = messageText || null;
  }

  // Zaplaceno → štítek: seznam dvojic (varianta A, Jakub 18. 10. 2026).
  let dvojice: { productId: string; tagId: string }[] | null = null;
  if (id === "zaplaceno-stitek") {
    const { produkty, stitky } = vstup.data;
    if (produkty.length !== stitky.length) return { ok: false, chyba: "Neplatný požadavek." };
    const unikatni = new Map<string, { productId: string; tagId: string }>();
    for (const [i, productId] of produkty.entries()) {
      const tagId = stitky[i];
      if (!productId && !tagId) continue;
      if (!productId || !tagId) {
        return { ok: false, chyba: `Řádek ${i + 1}: vyber produkt i štítek.` };
      }
      unikatni.set(`${productId}:${tagId}`, { productId, tagId });
    }
    dvojice = [...unikatni.values()];

    const [znamychProduktu, znamychStitku] = await Promise.all([
      db.product.count({
        where: { id: { in: dvojice.map((d) => d.productId) }, deletedAt: null },
      }),
      db.clientTag.count({ where: { id: { in: dvojice.map((d) => d.tagId) }, deletedAt: null } }),
    ]);
    if (znamychProduktu !== new Set(dvojice.map((d) => d.productId)).size) {
      return { ok: false, chyba: "Některý z produktů v ceníku není." };
    }
    if (znamychStitku !== new Set(dvojice.map((d) => d.tagId)).size) {
      return { ok: false, chyba: "Některý ze štítků neexistuje." };
    }
    if (zapnout && dvojice.length === 0) {
      return { ok: false, chyba: "Přidej aspoň jeden řádek produkt → štítek." };
    }
  }

  const po = { ...predtim, ...data };
  await db.$transaction(async (tx) => {
    await tx.automationRule.update({ where: { id }, data });
    if (dvojice) {
      await tx.automationTagPair.deleteMany({});
      await tx.automationTagPair.createMany({ data: dvojice });
    }
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "automation_rules",
      entityId: id,
      action: "pravidlo.zmeneno",
      // Bez textu zprávy — jen jestli se změnil (audit nemá nést obsah).
      before: { zapnuto: predtim.enabled },
      after: {
        zapnuto: zapnout,
        ...(dvojice ? { dvojice } : {}),
        ...(po.messageText !== predtim.messageText || po.messageTitle !== predtim.messageTitle
          ? { textZmenen: true }
          : {}),
      },
    });
  });

  revalidatePath("/pravidla");
  const nazev = POPIS_PRAVIDLA[id].nazev;
  return { ok: true, zprava: zapnout ? `Zapnuto: ${nazev}.` : `Vypnuto: ${nazev}.` };
}
