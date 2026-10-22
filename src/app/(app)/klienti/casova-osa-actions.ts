"use server";

import { z } from "zod";

import { nactiCasovouOsu, type VysledekOsy } from "@/lib/casova-osa";
import { DRUHY_OSY } from "@/lib/casova-osa-druhy";
import { requireViewer } from "@/lib/session";

/**
 * Načtení časové osy klienta do okna na kartě (Fáze 5B, Jakub 16. 10. 2026).
 *
 * Vidí každý přihlášený, kdo vidí kartu; druh Změny (audit) jen
 * administrátor. Obojí hlídá `nactiCasovouOsu()` — tady se jen ověří vstup.
 */

const vstupSchema = z.object({
  klientId: z.string().trim().min(1).max(64),
  druh: z.enum(DRUHY_OSY).nullable(),
  pred: z.iso.datetime().nullable(),
});

export async function nactiOsuKlienta(
  klientId: string,
  druh: string | null,
  pred: string | null,
): Promise<VysledekOsy> {
  const viewer = await requireViewer();

  const vstup = vstupSchema.safeParse({ klientId, druh, pred });
  if (!vstup.success) return { ok: false };

  return nactiCasovouOsu(viewer, vstup.data.klientId, {
    druh: vstup.data.druh,
    pred: vstup.data.pred ? new Date(vstup.data.pred) : null,
  });
}
