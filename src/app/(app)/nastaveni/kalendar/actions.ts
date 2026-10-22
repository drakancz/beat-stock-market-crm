"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { vyzkousejKalendar, zapisBudouciRezervace } from "@/lib/kalendar";
import { requireAdmin } from "@/lib/session";

/**
 * Nastavení → Kalendář (Jakub, 20. 10. 2026). **Vidí i mění jen
 * administrátor** — zábrana je v rámu Nastavení a každá akce volá
 * `requireAdmin()` znovu. Klíč servisního účtu se tu nezadává, je jen
 * v prostředí serveru.
 */

export type VysledekKalendare = { ok: true; zprava: string } | { ok: false; chyba: string };

const kalendarSchema = z.object({
  // ID kalendáře: u Gmailu jeho adresa, u dalších kalendářů
  // `…@group.calendar.google.com`. Jde do adresy požadavku na Google.
  googleCalendarId: z
    .string()
    .trim()
    .max(200, "ID kalendáře je příliš dlouhé.")
    .refine(
      (text) => text === "" || /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text),
      "ID kalendáře má tvar adresy — u Gmailu je to přímo e-mail účtu.",
    )
    .transform((text) => (text === "" ? null : text)),
  googleCalendarActive: z.enum(["on"]).nullable(),
});

export async function ulozKalendar(formData: FormData): Promise<VysledekKalendare> {
  const admin = await requireAdmin();

  const vstup = kalendarSchema.safeParse({
    googleCalendarId: formData.get("googleCalendarId") ?? "",
    googleCalendarActive: formData.get("googleCalendarActive"),
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const data = {
    googleCalendarId: vstup.data.googleCalendarId,
    googleCalendarActive: vstup.data.googleCalendarActive === "on",
  };
  if (data.googleCalendarActive && !data.googleCalendarId) {
    return { ok: false, chyba: "Bez ID kalendáře napojení zapnout nejde." };
  }
  // Zapíná se jen kalendář, ke kterému se CRM opravdu dostane.
  if (data.googleCalendarActive) {
    const duvod = await vyzkousejKalendar(data.googleCalendarId!);
    if (duvod) return { ok: false, chyba: duvod };
  }

  const puvodni = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { googleCalendarId: true, googleCalendarActive: true },
  });
  const rozdil = rozdilProAudit(
    { googleCalendarId: null, googleCalendarActive: false, ...puvodni },
    data,
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

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
      action: "nastaveni.kalendar",
      ...rozdil,
    });
  });

  revalidatePath("/nastaveni/kalendar");
  return {
    ok: true,
    zprava: data.googleCalendarActive
      ? "Kalendář je připojený. Nové rezervace se do něj budou zapisovat."
      : "Napojení na kalendář je vypnuté.",
  };
}

/** Zkouška spojení s uloženým kalendářem. */
export async function vyzkousej(): Promise<VysledekKalendare> {
  await requireAdmin();

  const nastaveni = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { googleCalendarId: true },
  });
  if (!nastaveni?.googleCalendarId) return { ok: false, chyba: "Nejdřív ulož ID kalendáře." };
  const duvod = await vyzkousejKalendar(nastaveni.googleCalendarId);
  return duvod
    ? { ok: false, chyba: duvod }
    : { ok: true, zprava: "Spojení s kalendářem funguje." };
}

/** Zapíše budoucí rezervace, které v kalendáři ještě nejsou (nebo se nezapsaly). */
export async function zapisBudouci(): Promise<VysledekKalendare> {
  await requireAdmin();

  const vysledek = await zapisBudouciRezervace();
  if (!vysledek.ok) return vysledek;
  revalidatePath("/nastaveni/kalendar");
  if (vysledek.chyb > 0) {
    return {
      ok: false,
      chyba: `Zapsané rezervace: ${vysledek.zapsano}, nezapsané: ${vysledek.chyb}. Důvod je v Chybách.`,
    };
  }
  return { ok: true, zprava: `Zapsané budoucí rezervace: ${vysledek.zapsano}.` };
}
