"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { denSchema } from "@/lib/obdobi";
import { requireAdmin } from "@/lib/session";
import { svatekDne } from "@/lib/svatky";

/**
 * Pracovní dny a volno firmy (Nastavení → Pracovní dny). **Smí jen
 * administrátor** (Jakub, 10. 9. 2026). Státní svátky se počítají samy
 * (`src/lib/svatky.ts`), sem patří jen pracovní dny v týdnu a vlastní
 * volno. Zrušené volno se nemaže, dostane `deletedAt`.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

function obnov() {
  revalidatePath("/nastaveni/pracovni-dny");
  revalidatePath("/dashboard");
}

/** Zaškrtnuté dny v týdnu: 1 = pondělí … 7 = neděle. */
const pracovniDnySchema = z
  .array(
    z
      .string({ error: "Neplatný den v týdnu." })
      .regex(/^[1-7]$/, "Neplatný den v týdnu.")
      .transform(Number),
  )
  .min(1, "Aspoň jeden den v týdnu musí být pracovní.");

export async function ulozPracovniDny(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = pracovniDnySchema.safeParse(formData.getAll("den"));
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const dny = [...new Set(vstup.data)].sort((a, b) => a - b);

  const { workDays } = await nactiNastaveni();
  const rozdil = rozdilProAudit({ pracovniDny: workDays }, { pracovniDny: dny });
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: { workDays: dny },
      create: { id: "firma", workDays: dny },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.pracovni-dny",
      ...rozdil,
    });
  });

  obnov();
  return { ok: true, zprava: "Pracovní dny jsou uložené." };
}

const volnoSchema = z.object({
  // Jen skutečný den v kalendáři (`31. 2.` neprojde).
  datum: z
    .string()
    .trim()
    .refine((hodnota) => denSchema.safeParse(hodnota).success, "Vyber platné datum."),
  name: z
    .string()
    .trim()
    .min(2, "Napiš, proč je volno — třeba „Firemní dovolená“.")
    .max(80, "Popis volna je příliš dlouhý."),
});

export async function pridejVolno(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = volnoSchema.safeParse({
    datum: formData.get("datum") ?? "",
    name: formData.get("name") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const datum = vstup.data.datum;

  const svatek = svatekDne(datum);
  if (svatek) return { ok: false, chyba: `Ten den je státní svátek: ${svatek}.` };

  const den = new Date(`${datum}T00:00:00Z`);
  if (
    await db.companyDayOff.findFirst({
      where: { date: den, deletedAt: null },
      select: { id: true },
    })
  ) {
    return { ok: false, chyba: "Na ten den už volno zapsané je." };
  }

  await db.$transaction(async (tx) => {
    const volno = await tx.companyDayOff.create({
      data: { date: den, name: vstup.data.name },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_days_off",
      entityId: volno.id,
      action: "volno.pridano",
      after: { name: vstup.data.name, datum },
    });
  });

  obnov();
  return { ok: true, zprava: `Volno ${vstup.data.name} je zapsané.` };
}

export async function zrusVolno(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Takové volno neexistuje." };

  const volno = await db.companyDayOff.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, name: true, date: true },
  });
  if (!volno) return { ok: false, chyba: "Takové volno neexistuje, nebo už je zrušené." };

  await db.$transaction(async (tx) => {
    await tx.companyDayOff.update({ where: { id: volno.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_days_off",
      entityId: volno.id,
      action: "volno.zruseno",
      before: { name: volno.name, datum: volno.date.toISOString().slice(0, 10) },
    });
  });

  obnov();
  return { ok: true, zprava: `Volno ${volno.name} je zrušené.` };
}
