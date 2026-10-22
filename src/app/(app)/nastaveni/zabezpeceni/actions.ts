"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { MAX_HODIN_PRIHLASENI, nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";
import { jeUkazkovyTym, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";

/**
 * Zabezpečení (Nastavení → Zabezpečení). **Smí jen administrátor.**
 *
 * - Povinné dvoufázové ověření: kdo ho povinné má a nemá zapnuté, pustí
 *   `requireViewer()` jen na Můj účet (Jakub, 10. 9. 2026).
 * - Délka přihlášení: hlídá `getViewer()`. Zkrácení platí hned, i pro
 *   ty, kdo jsou právě přihlášení.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const zabezpeceniSchema = z.object({
  twoFactorPolicy: z.enum(["NIKDO", "ADMINISTRATORI", "VSICHNI"], {
    error: "Vyber, pro koho je dvoufázové ověření povinné.",
  }),
  sessionHours: z.coerce
    .number({ error: "Délka přihlášení musí být číslo." })
    .int("Délka přihlášení je v celých hodinách.")
    .min(1, "Přihlášení musí platit aspoň hodinu.")
    .max(MAX_HODIN_PRIHLASENI, `Přihlášení může platit nejvýš ${MAX_HODIN_PRIHLASENI} hodin.`),
});

export async function ulozZabezpeceni(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();
  // Povinné dvoufázové ověření by zamklo ostatní návštěvníky ukázky.
  if (jeUkazkovyTym(admin.email)) return { ok: false, chyba: VYPNUTO_V_UKAZCE };

  const vstup = zabezpeceniSchema.safeParse({
    twoFactorPolicy: formData.get("twoFactorPolicy"),
    sessionHours: formData.get("sessionHours"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const puvodni = await nactiNastaveni();
  const rozdil = rozdilProAudit(
    { twoFactorPolicy: puvodni.twoFactorPolicy, sessionHours: puvodni.sessionHours },
    vstup.data,
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: vstup.data,
      create: { id: "firma", ...vstup.data },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.zabezpeceni",
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/zabezpeceni");
  return { ok: true, zprava: "Zabezpečení je uložené." };
}
