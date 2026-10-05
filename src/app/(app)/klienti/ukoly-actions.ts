"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { nastavHotovoUkolu, ukolKUprave, ukolSchema, zalozUkolProKlienta } from "@/lib/ukoly";

import type { Vysledek } from "./actions";

/**
 * Úkoly u klienta (Jakub, 22. 9. 2026).
 *
 * Do té doby se úkoly jen zobrazovaly — nešly založit ani odškrtnout
 * a na kartě klienta bylo tlačítko „Přidat úkol", které nic nedělalo.
 *
 * **Oprávnění, jak je Jakub určil:**
 *
 * 1. **Zakládá každý, ale jen sobě.** Manažer a administrátor smí úkol
 *    zadat i kolegovi. Obchodníkovi se pole „komu" vůbec nenabízí a kdyby
 *    ho poslal přes adresu, akce ho odmítne.
 * 2. **Mění a maže majitel a administrátor.** Manažer úkoly týmu vidí
 *    (na kartě klienta), ale neodškrtává je za ně — jinak by v seznamu
 *    nebylo poznat, kdo práci opravdu udělal. Stejné pravidlo jako
 *    u zápisu hovoru.
 * 3. **Vždycky přes viditelnost klienta.** Na úkol u cizího klienta se
 *    nedá dostat ani přes adresu; odpověď je stejná jako u neexistujícího
 *    záznamu, aby se neprozradilo, co v systému je.
 *
 * Založení a odškrtnutí jsou od 5. 10. 2026 ve společných funkcích
 * (`src/lib/ukoly.ts`), které používá i AI přes MCP — pravidla výš tak
 * platí pro oba stejně.
 *
 * Úkol se **nemaže z databáze**, jen dostane `deletedAt` — stejně jako
 * hovor. Do obrazovky Smazané nechodí.
 */

/** Po změně úkolu se obnoví Dashboard, kde úkoly od 23. 9. 2026 žijí, i karta klienta. */
function obnovStranky(klientId: string) {
  revalidatePath(`/klienti/${klientId}`);
  revalidatePath("/dashboard");
}

export async function zalozUkol(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const vysledek = await zalozUkolProKlienta(viewer, {
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    userId: formData.get("userId"),
  });
  if (!vysledek.ok) return vysledek;

  obnovStranky(vysledek.klientId);

  return {
    ok: true,
    id: vysledek.id,
    zprava: `Úkol u klienta ${vysledek.klientJmeno} je založený.`,
  };
}

/** Odškrtnutí a vrácení zpět. */
export async function prepniHotovoUkolu(idRaw: string, hotovoRaw: boolean): Promise<Vysledek> {
  const viewer = await requireViewer();

  const vysledek = await nastavHotovoUkolu(viewer, idRaw, hotovoRaw);
  if (!vysledek.ok) return vysledek;

  obnovStranky(vysledek.klientId);

  return { ok: true, zprava: hotovoRaw ? "Úkol je hotový." : "Úkol je zpátky mezi čekajícími." };
}

export async function upravUkol(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(formData.get("id"));
  if (!id.success) return { ok: false, chyba: "Neplatný úkol." };

  const ukol = await ukolKUprave(viewer, id.data);
  if (!ukol) return { ok: false, chyba: "Takový úkol neexistuje." };

  const data = ukolSchema.safeParse({
    title: formData.get("title") ?? "",
    dueAt: formData.get("dueAt") ?? "",
  });
  if (!data.success) return { ok: false, chyba: data.error.issues[0].message };

  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: ukol.id },
      data: { title: data.data.title, dueAt: data.data.dueAt },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "tasks",
      entityId: ukol.id,
      action: "ukol.upraven",
      before: { dueAt: ukol.dueAt.toISOString() },
      after: { dueAt: data.data.dueAt.toISOString() },
    });
  });

  obnovStranky(ukol.client.id);

  return { ok: true, zprava: "Úkol je upravený." };
}

export async function smazUkol(idRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný úkol." };

  const ukol = await ukolKUprave(viewer, id.data);
  if (!ukol) return { ok: false, chyba: "Takový úkol neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id: ukol.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "tasks",
      entityId: ukol.id,
      action: "ukol.smazan",
      before: { clientId: ukol.client.id, dueAt: ukol.dueAt.toISOString() },
    });
  });

  obnovStranky(ukol.client.id);

  return { ok: true, zprava: "Úkol je smazaný." };
}

/**
 * Kdo připadá v úvahu jako majitel úkolu.
 *
 * Vrací prázdný seznam obchodníkovi — ten zadává jen sobě, takže výběr
 * nepotřebuje. **Není to ochrana**, tou je `komuPatri()` v akci samotné;
 * tohle jen plní nabídku ve formuláři.
 */
export async function nactiMozneMajitele(): Promise<{ id: string; name: string }[]> {
  const viewer = await requireViewer();
  if (viewer.role !== "ADMINISTRATOR") return [];

  return db.user.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
