"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { nactiNastaveni } from "@/lib/nastaveni";
import { predejUkolyNaProdlouzeni } from "@/lib/platnost";
import { requireAdmin } from "@/lib/session";

/**
 * Nastavení → Prodloužení (Jakub, 24. 9. 2026): komu CRM zakládá úkol
 * „zavolat kvůli prodloužení" a kolik dní před koncem platnosti.
 *
 * **Vidí i mění jen administrátor.** Nepřihlášený se k tomu nedostane.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const vstupSchema = z.object({
  // Prázdné = nikdo, úkoly nevznikají.
  renewalUserId: z
    .string()
    .trim()
    .max(64)
    .transform((hodnota) => (hodnota === "" || hodnota === "nikdo" ? null : hodnota)),
  renewalLeadDays: z.coerce
    .number({ error: "Počet dní musí být číslo." })
    .int("Počet dní musí být celé číslo.")
    .min(1, "Úkol musí vzniknout aspoň den předem.")
    .max(90, "Víc než 90 dní předem nejde."),
});

export async function ulozProdlouzeni(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = vstupSchema.safeParse({
    renewalUserId: formData.get("renewalUserId") ?? "",
    renewalLeadDays: formData.get("renewalLeadDays") ?? "",
  });
  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Neplatný požadavek." };
  }
  const { renewalUserId, renewalLeadDays } = vstup.data;

  // Vybrat jde jen člověka, který se může přihlásit — jinak by úkoly
  // padaly někomu, kdo je nikdy neuvidí.
  const resitel = renewalUserId
    ? await db.user.findFirst({
        where: { id: renewalUserId, active: true, deletedAt: null },
        select: { id: true, name: true },
      })
    : null;
  if (renewalUserId && !resitel) return { ok: false, chyba: "Vybraný člověk v týmu není." };

  const puvodni = await nactiNastaveni();
  const rozdil = rozdilProAudit(
    { renewalUserId: puvodni.renewalUserId, renewalLeadDays: puvodni.renewalLeadDays },
    { renewalUserId, renewalLeadDays },
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  const predano = await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: { renewalUserId, renewalLeadDays },
      create: { id: "firma", renewalUserId, renewalLeadDays },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.prodlouzeni",
      ...rozdil,
    });

    // Otevřené úkoly na prodloužení přejdou na nového člověka — jinak by
    // zůstaly tomu, kdo to už neřeší.
    if (resitel && resitel.id !== puvodni.renewalUserId) {
      return predejUkolyNaProdlouzeni(tx, resitel.id);
    }
    return 0;
  });

  revalidatePath("/nastaveni/prodlouzeni");
  revalidatePath("/dashboard");

  return {
    ok: true,
    zprava:
      predano > 0
        ? `Uloženo. Otevřené úkoly na prodloužení přešly na nového člověka: ${pocet(predano, "úkol", "úkoly", "úkolů")}.`
        : "Nastavení prodloužení je uložené.",
  };
}
