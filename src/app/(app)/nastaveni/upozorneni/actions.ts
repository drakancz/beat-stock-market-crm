"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";

/**
 * Upozornění na chyby (Nastavení → Upozornění). **Vidí i mění jen
 * administrátor** (Jakub, 15. 9. 2026). Nepřihlášený se k tomu nedostane.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

export async function ulozUpozorneni(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  // Zaškrtávací políčko se v datech objeví jen zapnuté, s hodnotou "on".
  const vstup = z.enum(["on"]).nullable().safeParse(formData.get("errorNotificationsEnabled"));
  if (!vstup.success) return { ok: false, chyba: "Neplatný požadavek." };
  const errorNotificationsEnabled = vstup.data === "on";

  const puvodni = await nactiNastaveni();
  const rozdil = rozdilProAudit(
    { errorNotificationsEnabled: puvodni.errorNotificationsEnabled },
    { errorNotificationsEnabled },
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: { errorNotificationsEnabled },
      create: { id: "firma", errorNotificationsEnabled },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.upozorneni",
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/upozorneni");
  return {
    ok: true,
    zprava: errorNotificationsEnabled
      ? "Upozornění na chyby jsou zapnutá."
      : "Upozornění na chyby jsou vypnutá.",
  };
}
