"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { ulozitelnyDotaz } from "@/lib/filtry";
import { requireViewer } from "@/lib/session";

/**
 * Uložené filtry seznamu klientů (Fáze 5B, Jakub 11. 10. 2026).
 *
 * - **Uložit smí každý přihlášený** — filtr je jeho, vidí ho jen on.
 * - **Sdílet s týmem smí jen administrátor** (`shared`).
 * - **Smazat smí autor; sdílený navíc administrátor.**
 *
 * Do auditu se nepíše — je to osobní zkratka, ne změna údajů. Ukládá se
 * jen část adresy s parametry filtru (`ulozitelnyDotaz()`), nic jiného.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/** Víc uložených filtrů na člověka by nebylo vidět. */
const MAX_FILTRU = 20;

const ID = z.string().trim().min(1).max(64);

export async function ulozFiltr(nazevRaw: string, dotazRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const vstup = z
    .object({
      nazev: z.string().trim().min(1, "Napiš název filtru.").max(60, "Název je příliš dlouhý."),
      dotaz: z.string().max(1000),
    })
    .safeParse({ nazev: nazevRaw, dotaz: dotazRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const query = ulozitelnyDotaz(Object.fromEntries(new URLSearchParams(vstup.data.dotaz)));
  if (!query) return { ok: false, chyba: "Nejdřív nastav filtr, pak ho ulož." };

  const mam = await db.savedFilter.count({ where: { userId: viewer.id } });
  if (mam >= MAX_FILTRU) {
    return { ok: false, chyba: `Uložit jde nejvýš ${MAX_FILTRU} filtrů. Nějaký nejdřív smaž.` };
  }

  await db.savedFilter.create({ data: { userId: viewer.id, name: vstup.data.nazev, query } });
  revalidatePath("/klienti");
  return { ok: true, zprava: `Filtr je uložený: ${vstup.data.nazev}.` };
}

/** Sdílení s týmem — jen administrátor, jen u vlastního filtru. */
export async function sdilejFiltr(idRaw: string, sdiletRaw: boolean): Promise<Vysledek> {
  const viewer = await requireViewer();
  const id = ID.safeParse(idRaw);
  const sdilet = z.boolean().safeParse(sdiletRaw);
  if (!id.success || !sdilet.success) return { ok: false, chyba: "Neplatný požadavek." };
  if (viewer.role !== "ADMINISTRATOR") {
    return { ok: false, chyba: "Sdílet filtr s týmem smí jen administrátor." };
  }

  const filtr = await db.savedFilter.findFirst({
    where: { id: id.data, userId: viewer.id },
    select: { id: true, name: true },
  });
  if (!filtr) return { ok: false, chyba: "Takový filtr neexistuje." };

  await db.savedFilter.update({ where: { id: filtr.id }, data: { shared: sdilet.data } });
  revalidatePath("/klienti");
  return {
    ok: true,
    zprava: sdilet.data
      ? `Filtr ${filtr.name} teď vidí celý tým.`
      : `Filtr ${filtr.name} vidíš už jen ty.`,
  };
}

/** Smazání — autor svůj, administrátor i sdílený. Potvrzuje se v okně. */
export async function smazFiltr(idRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const filtr = await db.savedFilter.findFirst({
    where: {
      id: id.data,
      OR: [{ userId: viewer.id }, ...(viewer.role === "ADMINISTRATOR" ? [{ shared: true }] : [])],
    },
    select: { id: true, name: true },
  });
  if (!filtr) return { ok: false, chyba: "Takový filtr neexistuje." };

  await db.savedFilter.delete({ where: { id: filtr.id } });
  revalidatePath("/klienti");
  return { ok: true, zprava: `Smazáno: filtr ${filtr.name}.` };
}
