"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { TVAR_MESICE, nactiCileProNastaveni } from "@/lib/cile";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";

/**
 * Cíle tržeb (Nastavení → Cíle). **Nastavuje jen administrátor**
 * (Jakub, 10. 9. 2026).
 *
 * Ukládá se jen to, co se oproti platnému cíli změnilo — záznam pro
 * vybraný měsíc, který pak platí i do dalších měsíců. Prázdné políčko
 * znamená „od tohoto měsíce bez cíle" (uloží se 0).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/** Částka z formuláře: česky, s čárkou a mezerami. Prázdné políčko = 0. */
const castkaSchema = z
  .string()
  .transform((text) => text.replace(/\s/g, "").replace(",", "."))
  .refine((cisty) => cisty === "" || /^\d{1,10}(\.\d{1,2})?$/.test(cisty))
  .transform((cisty) => (cisty === "" ? 0 : Number(cisty)));

const mesicSchema = z.string().regex(TVAR_MESICE);

export async function ulozCile(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const zadanyMesic = mesicSchema.safeParse(formData.get("mesic"));
  if (!zadanyMesic.success) return { ok: false, chyba: "Neplatný měsíc." };
  const mesic = zadanyMesic.data;

  // Jen řádky, které v Nastavení opravdu jsou — cizí id z formuláře se
  // nikam nezapíše (security_warnings.md, pravidlo 11).
  const radky = await nactiCileProNastaveni(mesic);

  const zmeny: { userId: string | null; name: string; z: number; na: number }[] = [];
  for (const radek of radky) {
    const zadano = formData.get(`cil:${radek.userId ?? "tym"}`);
    if (zadano === null) continue;

    const zadanaCastka = castkaSchema.safeParse(zadano);
    if (!zadanaCastka.success)
      return { ok: false, chyba: `Cíl u „${radek.name}" musí být částka v Kč.` };
    const castka = zadanaCastka.data;
    if (castka !== radek.castka) {
      zmeny.push({ userId: radek.userId, name: radek.name, z: radek.castka, na: castka });
    }
  }

  if (zmeny.length === 0) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    for (const zmena of zmeny) {
      const stavajici = await tx.salesTarget.findFirst({
        where: { month: mesic, userId: zmena.userId },
        select: { id: true },
      });

      const zaznam = stavajici
        ? await tx.salesTarget.update({
            where: { id: stavajici.id },
            data: { amount: zmena.na },
            select: { id: true },
          })
        : await tx.salesTarget.create({
            data: { month: mesic, userId: zmena.userId, amount: zmena.na },
            select: { id: true },
          });

      await zapisDoAuditu(tx, {
        userId: admin.id,
        entity: "sales_targets",
        entityId: zaznam.id,
        action: "cil.nastaven",
        before: { name: zmena.name, mesic, castka: zmena.z },
        after: { castka: zmena.na },
      });
    }
  });

  revalidatePath("/nastaveni/cile");
  revalidatePath("/dashboard");

  return { ok: true, zprava: `Uloženo: ${pocet(zmeny.length, "cíl", "cíle", "cílů")}.` };
}
