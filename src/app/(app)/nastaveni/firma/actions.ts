"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { posliZkusebniEmail } from "@/lib/email";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";

/**
 * Údaje firmy a e-maily (Nastavení → Firma a e-maily).
 *
 * **Smí jen administrátor** (Jakub, 10. 9. 2026). Všechno se ověřuje
 * tady — typ, délka, tvar (security_warnings.md, pravidlo 11). Jméno
 * odesílatele jde do hlavičky e-mailu, proto v něm nesmí být konec řádku
 * ani znaky, kterými by se dala hlavička rozbít.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/** Prázdné políčko = údaj nevyplněný. */
const nepovinny = (max: number, zprava: string) =>
  z
    .string()
    .trim()
    .max(max, zprava)
    .transform((text) => (text === "" ? null : text));

const firmaSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Název firmy je příliš krátký.")
    .max(120, "Název firmy je příliš dlouhý."),
  ico: z
    .string()
    .trim()
    .transform((text) => text.replace(/\s/g, ""))
    .refine((text) => text === "" || /^\d{8}$/.test(text), "IČO má osm číslic.")
    .transform((text) => (text === "" ? null : text)),
  dic: z
    .string()
    .trim()
    .transform((text) => text.replace(/\s/g, "").toUpperCase())
    .refine((text) => text === "" || /^CZ\d{8,10}$/.test(text), "DIČ má tvar CZ a 8 až 10 číslic.")
    .transform((text) => (text === "" ? null : text)),
  address: nepovinny(200, "Adresa je příliš dlouhá."),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "E-mail je příliš dlouhý.")
    .refine(
      (text) => text === "" || z.email().safeParse(text).success,
      "Tohle nevypadá jako e-mail.",
    )
    .transform((text) => (text === "" ? null : text)),
  vatPayer: z.boolean(),
});

const emailySchema = z.object({
  emailSenderName: nepovinny(80, "Jméno odesílatele je příliš dlouhé.").refine(
    (text) => text === null || !/[\r\n"<>]/.test(text),
    "Jméno odesílatele nesmí obsahovat uvozovky, < > ani konec řádku.",
  ),
  emailSignature: nepovinny(1000, "Podpis je příliš dlouhý."),
});

async function uloz(data: Record<string, unknown>, akce: "nastaveni.firma" | "nastaveni.emaily") {
  const admin = await requireAdmin();
  const puvodni = await nactiNastaveni();

  const rozdil = rozdilProAudit(puvodni as unknown as Record<string, unknown>, data);
  if (!rozdil) return false;

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: data,
      create: { id: "firma", ...data },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: akce,
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/firma");
  return true;
}

export async function ulozFirmu(formData: FormData): Promise<Vysledek> {
  await requireAdmin();

  const vstup = firmaSchema.safeParse({
    companyName: formData.get("companyName") ?? "",
    ico: formData.get("ico") ?? "",
    dic: formData.get("dic") ?? "",
    address: formData.get("address") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
    vatPayer: formData.get("vatPayer") === "on",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const zmeneno = await uloz(vstup.data, "nastaveni.firma");
  return { ok: true, zprava: zmeneno ? "Údaje firmy jsou uložené." : "Nic se nezměnilo." };
}

export async function ulozEmaily(formData: FormData): Promise<Vysledek> {
  await requireAdmin();

  const vstup = emailySchema.safeParse({
    emailSenderName: formData.get("emailSenderName") ?? "",
    emailSignature: formData.get("emailSignature") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const zmeneno = await uloz(vstup.data, "nastaveni.emaily");
  return { ok: true, zprava: zmeneno ? "Nastavení e-mailů je uložené." : "Nic se nezměnilo." };
}

/** Zkušební zpráva administrátorovi samotnému — ať vidí, jak e-maily vypadají. */
export async function posliZkusebni(): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vysledek = await posliZkusebniEmail({
    komu: admin.email,
    osloveni: admin.osloveni,
    userId: admin.id,
    spustilId: admin.id,
  });
  if (vysledek.odeslano) return { ok: true, zprava: `Zkušební e-mail odešel na ${admin.email}.` };

  return {
    ok: false,
    chyba:
      vysledek.duvod === "nenastaveno"
        ? "Odesílání e-mailů není na serveru nastavené."
        : "Odeslání se nepovedlo. Zkus to za chvíli znovu.",
  };
}
