"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { pocet } from "@/lib/mnozne";
import { requireViewer } from "@/lib/session";
import { MAX_HROMADNE, nastavStitek } from "@/lib/stitky";

/**
 * Štítek u klienta — na kartě i hromadně v seznamu (Fáze 5B, Jakub
 * 11. 10. 2026). **Smí každý přihlášený**; seznam štítků spravuje jen
 * administrátor (`nastaveni/stitky/actions.ts`). Viditelnost klientů
 * hlídá `nastavStitek()` v dotazu.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const vstupSchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(64))
    .min(1, "Vyber aspoň jednoho klienta.")
    .max(MAX_HROMADNE, `Najednou jde upravit nejvýš ${MAX_HROMADNE} klientů.`),
  tagId: z.string().trim().min(1, "Vyber štítek.").max(64),
  pridat: z.boolean(),
});

export async function nastavStitekKlientum(
  idsRaw: string[],
  tagIdRaw: string,
  pridatRaw: boolean,
): Promise<Vysledek> {
  const viewer = await requireViewer();

  const vstup = vstupSchema.safeParse({ ids: idsRaw, tagId: tagIdRaw, pridat: pridatRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { ids, tagId, pridat } = vstup.data;

  const vysledek = await nastavStitek(viewer, [...new Set(ids)], tagId, pridat);
  if (!vysledek.ok) return vysledek;

  revalidatePath("/klienti");
  for (const id of ids.slice(0, 1)) revalidatePath(`/klienti/${id}`);

  const komu = pocet(vysledek.zmeneno, "klientovi", "klientům", "klientům");
  if (vysledek.zmeneno === 0) return { ok: true, zprava: "Nic se nezměnilo." };
  return {
    ok: true,
    zprava: pridat
      ? `Štítek ${vysledek.stitek} je přidaný ${komu}.`
      : `Štítek ${vysledek.stitek} je odebraný ${komu}.`,
  };
}
