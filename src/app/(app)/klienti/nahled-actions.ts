"use server";

import { z } from "zod";

import { nactiNahledKlienta, type NahledKlienta } from "@/lib/nahled-klienta";
import { requireViewer } from "@/lib/session";

/**
 * Rychlý náhled klienta ze seznamu (Fáze 5B, Jakub 18. 10. 2026).
 *
 * Vidí každý přihlášený, kdo vidí kartu; jen čtení. Viditelnost hlídá
 * `nactiNahledKlienta()` v dotazu — tady se jen ověří vstup.
 */

const idSchema = z.string().trim().min(1).max(64);

export async function nactiNahled(klientId: string): Promise<NahledKlienta | null> {
  const viewer = await requireViewer();

  const id = idSchema.safeParse(klientId);
  if (!id.success) return null;

  return nactiNahledKlienta(viewer, id.data);
}
