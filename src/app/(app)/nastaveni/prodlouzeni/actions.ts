"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";

/**
 * Nastavení → Prodloužení: připomínky nezaplacené objednávky a hranice
 * „Platí, ale nechodí“. Úkol „zavolat kvůli prodloužení“ zanikl
 * 20. 10. 2026 (Jakub).
 *
 * **Vidí i mění jen administrátor.** Nepřihlášený se k tomu nedostane.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/* ---------- Připomínka nezaplacené objednávky (Fáze 5A, 11. 10. 2026) ---------- */

const platbySchema = z
  .object({
    zapnuto: z.enum(["ano", "ne"]),
    paymentReminderFirstDays: z.coerce
      .number({ error: "Počet dní musí být číslo." })
      .int("Počet dní musí být celé číslo.")
      .min(1, "První připomínka nejdřív den po objednávce.")
      .max(60, "Víc než 60 dní nejde."),
    paymentReminderSecondDays: z.coerce
      .number({ error: "Počet dní musí být číslo." })
      .int("Počet dní musí být celé číslo.")
      .min(1, "Druhá připomínka nejdřív den po objednávce.")
      .max(60, "Víc než 60 dní nejde."),
  })
  .refine(
    (vstup) => vstup.paymentReminderSecondDays > vstup.paymentReminderFirstDays,
    "Druhá připomínka musí přijít později než první.",
  );

/**
 * Nastavení připomínek nezaplacených objednávek. **Jen administrátor**
 * (Jakub, 11. 10. 2026). Kdy připomínka odešla, vidí u objednávky každý.
 */
export async function ulozPripominkyPlatby(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = platbySchema.safeParse({
    zapnuto: formData.get("zapnuto"),
    paymentReminderFirstDays: formData.get("paymentReminderFirstDays") ?? "",
    paymentReminderSecondDays: formData.get("paymentReminderSecondDays") ?? "",
  });
  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Neplatný požadavek." };
  }
  const { zapnuto, paymentReminderFirstDays, paymentReminderSecondDays } = vstup.data;
  const paymentRemindersEnabled = zapnuto === "ano";

  const puvodni = await nactiNastaveni();
  const nove = {
    paymentRemindersEnabled,
    paymentReminderFirstDays,
    paymentReminderSecondDays,
  };
  const rozdil = rozdilProAudit(
    {
      paymentRemindersEnabled: puvodni.paymentRemindersEnabled,
      paymentReminderFirstDays: puvodni.paymentReminderFirstDays,
      paymentReminderSecondDays: puvodni.paymentReminderSecondDays,
    },
    nove,
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: nove,
      create: { id: "firma", ...nove },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.pripominky-platby",
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/prodlouzeni");
  return { ok: true, zprava: "Připomínky platby jsou uložené." };
}

/* ---------- Platí, ale nechodí (Fáze 5B, 15. 10. 2026) ---------- */

const nechodiSchema = z.object({
  inactiveMemberDays: z.coerce
    .number({ error: "Počet dní musí být číslo." })
    .int("Počet dní musí být celé číslo.")
    .min(7, "Míň než týden nejde — značku by dostal i člen na dovolené.")
    .max(180, "Víc než 180 dní nejde."),
});

/**
 * Po kolika dnech bez návštěvy dostane člen značku „Nechodí“. **Jen
 * administrátor** (Jakub, 15. 10. 2026); značku vidí každý přihlášený.
 */
export async function ulozHraniciNechodi(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = nechodiSchema.safeParse({
    inactiveMemberDays: formData.get("inactiveMemberDays") ?? "",
  });
  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Neplatný požadavek." };
  }
  const { inactiveMemberDays } = vstup.data;

  const puvodni = await nactiNastaveni();
  const rozdil = rozdilProAudit(
    { inactiveMemberDays: puvodni.inactiveMemberDays },
    { inactiveMemberDays },
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: { inactiveMemberDays },
      create: { id: "firma", inactiveMemberDays },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.nechodi",
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/prodlouzeni");
  revalidatePath("/klienti");
  return {
    ok: true,
    zprava: `Uloženo. Značku Nechodí dostane člen po ${pocet(inactiveMemberDays, "dni", "dnech", "dnech")} bez návštěvy.`,
  };
}
