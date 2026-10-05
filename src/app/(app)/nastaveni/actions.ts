"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { popisSazby } from "@/lib/dph";
import { requireAdmin } from "@/lib/session";

/**
 * Změny v Nastavení.
 *
 * **Smí je dělat jen administrátor** (Jakub, 10. 9. 2026). `requireAdmin()`
 * je první řádek každé akce — rám sekce chrání zobrazení, ale akci jde
 * zavolat i bez něj (security_warnings.md, pravidlo 5). Zápis do auditního
 * logu je ve stejné transakci jako změna (pravidlo 7).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/**
 * Výše sazby z formuláře.
 *
 * Člověk píše česky — `21`, `12,5`, klidně i se znakem procenta. Přijme
 * se celé číslo do stovky s nejvýš dvěma desetinnými místy; nic jiného
 * se do databáze nedostane (pravidlo 11).
 */
const vyse = z
  .string()
  .trim()
  .transform((text) => text.replace(/\s|%/g, ""))
  .pipe(z.string().regex(/^\d{1,3}(?:[.,]\d{1,2})?$/, "Výši napiš jako číslo, třeba 21 nebo 12,5."))
  .transform((text) => Number(text.replace(",", ".")))
  .pipe(z.number().max(100, "Sazba nemůže být vyšší než 100 %."));

const sazbaSchema = z.object({
  id: z.string().trim().min(1).max(32),
  name: z
    .string()
    .trim()
    .min(2, "Název sazby je příliš krátký.")
    .max(40, "Název sazby je příliš dlouhý."),
  rate: vyse,
});

export async function upravSazbuDph(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = sazbaSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    rate: formData.get("rate") ?? "",
  });

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const { id, name, rate } = vstup.data;

  const puvodni = await db.vatRate.findUnique({
    where: { id },
    select: { name: true, rate: true },
  });
  if (!puvodni) return { ok: false, chyba: "Taková sazba neexistuje." };

  // Dvě sazby stejného jména by ve výběru u produktu nešly rozlišit.
  const kolize = await db.vatRate.findFirst({
    where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
    select: { name: true },
  });
  if (kolize) return { ok: false, chyba: `Sazba s názvem ${kolize.name} už existuje.` };

  const drive = { name: puvodni.name, vyse: puvodni.rate.toNumber() };
  if (drive.name === name && drive.vyse === rate) {
    return { ok: true, zprava: "Nic se nezměnilo." };
  }

  await db.$transaction(async (tx) => {
    await tx.vatRate.update({ where: { id }, data: { name, rate } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "vat_rates",
      entityId: id,
      action: "sazba-dph.upravena",
      before: drive,
      after: { name, vyse: rate },
    });
  });

  revalidatePath("/nastaveni");
  revalidatePath("/produkty");

  return { ok: true, zprava: `Sazba ${name} je teď ${popisSazby(rate)}.` };
}
