import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prectiDen } from "@/lib/obdobi";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";

/**
 * Úkoly — společné pro Můj den v CRM (`klienti/ukoly-actions.ts`) a pro
 * AI přes MCP (Jakub, 5. 10. 2026). AI tak platí přesně stejná pravidla
 * jako člověk; podrobně jsou popsaná u akcí.
 *
 * - **Zakládá každý, ale jen sobě.** Kolegovi zadá úkol jen administrátor.
 * - **Mění a odškrtává majitel a administrátor.**
 * - **Vždycky přes viditelnost klienta** — cizí úkol vypadá jako
 *   neexistující.
 */

/**
 * Text úkolu a termín. Termín je povinný — úkol bez data není seznam práce.
 *
 * Datum se nečte přes `denSchema` napřímo: ten hlásí chyby zodí výchozí
 * angličtinou a tohle jde uživateli do formuláře. `prectiDen()` je uvnitř
 * tentýž kód, jen s vlastní hláškou.
 *
 * **Termín v minulosti se povoluje.** Dopsat si úkol, který měl být hotový
 * včera, je běžné; seznam ho ukáže se značkou „Po termínu".
 */
export const ukolSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Napiš, co je potřeba udělat.")
    .max(200, "Název úkolu je příliš dlouhý."),
  dueAt: z
    .string()
    .trim()
    .min(1, "Vyplň termín úkolu.")
    .transform((hodnota) => prectiDen(hodnota))
    .refine((den): den is Date => den !== null, "Termín není platné datum."),
  userId: z.string().trim().max(64).optional(),
});

const idSchema = z.string().trim().min(1).max(64);

/**
 * Komu úkol patří.
 *
 * Bez vyplněného pole připadne tomu, kdo ho zakládá. Vyplnit ho smí jen
 * administrátor, a jen na **činný, nesmazaný** účet — jinak by úkol
 * dostal někdo, kdo se už nepřihlásí.
 */
async function komuPatri(viewer: Viewer, zadany: string | undefined): Promise<string | null> {
  if (!zadany || zadany === viewer.id) return viewer.id;

  // Úkol kolegovi zadá jen administrátor (od 22. 9. 2026; dřív i
  // manažer). Běžný uživatel si zadává jen sobě.
  if (viewer.role !== "ADMINISTRATOR") return null;

  const clovek = await db.user.findFirst({
    where: { id: zadany, active: true, deletedAt: null },
    select: { id: true },
  });

  return clovek?.id ?? null;
}

/**
 * Úkol, na který přihlášený smí sáhnout.
 *
 * Dvě podmínky najednou: klient musí být v rozsahu jeho role **a** úkol
 * musí být jeho vlastní, ledaže je administrátor.
 */
export async function ukolKUprave(viewer: Viewer, id: string) {
  const ukol = await db.task.findFirst({
    where: { AND: [{ id, deletedAt: null }, { client: viditelniKlienti(viewer) }] },
    select: {
      id: true,
      userId: true,
      title: true,
      dueAt: true,
      doneAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  if (!ukol) return null;
  if (viewer.role !== "ADMINISTRATOR" && ukol.userId !== viewer.id) return null;
  return ukol;
}

export type VysledekUkolu =
  { ok: true; id: string; klientId: string; klientJmeno: string } | { ok: false; chyba: string };

/** Založí úkol u klienta. `vstup` přichází zvenku — ověřuje se celý. */
export async function zalozUkolProKlienta(
  viewer: Viewer,
  vstup: { clientId: unknown; title: unknown; dueAt: unknown; userId?: unknown },
  { presMcp = false }: { presMcp?: boolean } = {},
): Promise<VysledekUkolu> {
  // Na Dashboardu se klient vybírá v okně (od 23. 9. 2026) — prázdný
  // výběr je přehlédnutí, ne útok, tak ať to hláška řekne lidsky.
  const klientId = z
    .string()
    .trim()
    .min(1, "Vyber klienta.")
    .max(64, "Neplatný klient.")
    .safeParse(vstup.clientId ?? "");
  if (!klientId.success) return { ok: false, chyba: klientId.error.issues[0].message };

  // Rozsah role je v dotazu: na cizího klienta se přes adresu nedostane.
  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId.data }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const data = ukolSchema.safeParse({
    title: vstup.title ?? "",
    dueAt: vstup.dueAt ?? "",
    userId: vstup.userId ?? "",
  });
  if (!data.success) return { ok: false, chyba: data.error.issues[0].message };

  const userId = await komuPatri(viewer, data.data.userId);
  if (!userId) return { ok: false, chyba: "Úkol jde zadat jen sobě." };

  const ukol = await db.$transaction(async (tx) => {
    const zalozeny = await tx.task.create({
      data: {
        clientId: klient.id,
        userId,
        title: data.data.title,
        dueAt: data.data.dueAt,
        createdViaMcp: presMcp,
      },
      select: { id: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "tasks",
      entityId: zalozeny.id,
      action: "ukol.zalozen",
      after: {
        clientId: klient.id,
        dueAt: data.data.dueAt.toISOString(),
        // Komu úkol patří, je součást změny — zvlášť když ho zadalo vedení.
        userId,
        ...(presMcp ? { mcp: true } : {}),
      },
    });

    return zalozeny;
  });

  return { ok: true, id: ukol.id, klientId: klient.id, klientJmeno: klient.name };
}

/**
 * Odškrtnutí a vrácení zpět.
 *
 * `hotovo` se ověřuje zodem — typ v TypeScriptu platí jen v našem kódu,
 * prohlížeč i AI můžou poslat cokoli (security.md, pravidlo 4).
 */
export async function nastavHotovoUkolu(
  viewer: Viewer,
  idRaw: unknown,
  hotovoRaw: unknown,
  { presMcp = false }: { presMcp?: boolean } = {},
): Promise<VysledekUkolu> {
  const id = idSchema.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný úkol." };

  const hotovo = z.boolean().safeParse(hotovoRaw);
  if (!hotovo.success) return { ok: false, chyba: "Neplatná hodnota." };

  const ukol = await ukolKUprave(viewer, id.data);
  if (!ukol) return { ok: false, chyba: "Takový úkol neexistuje." };

  const doneAt = hotovo.data ? new Date() : null;

  await db.$transaction(async (tx) => {
    await tx.task.update({ where: { id: ukol.id }, data: { doneAt } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "tasks",
      entityId: ukol.id,
      action: hotovo.data ? "ukol.hotovy" : "ukol.vraceny",
      after: {
        clientId: ukol.client.id,
        doneAt: doneAt?.toISOString() ?? null,
        ...(presMcp ? { mcp: true } : {}),
      },
    });
  });

  return { ok: true, id: ukol.id, klientId: ukol.client.id, klientJmeno: ukol.client.name };
}
