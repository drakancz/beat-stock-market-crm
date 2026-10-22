"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { pozviKlienta, zrusUcetKlienta, type VysledekPozvanky } from "@/lib/klient/pozvanka";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import { CHRANENA_KARTA, jeChranenaKarta } from "@/lib/ukazka-ochrana";

/**
 * Účet klienta do klientské části — tlačítka na kartě klienta.
 *
 * **Oprávnění (Jakub, 30. 9. 2026):** pozvat, poslat pozvánku znovu
 * i zrušit přístup smí **jen administrátor**. Že má klient účet, vidí na
 * kartě každý přihlášený. Nepřihlášený ani uživatel se sem nedostane —
 * `requireAdmin()` vrací 404.
 */

const ID = z.string().trim().min(1).max(64);

async function overKlienta(idRaw: string) {
  const viewer = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return null;

  const klient = await db.client.findFirst({
    where: { AND: [{ id: id.data }, viditelniKlienti(viewer)] },
    select: { id: true },
  });
  return klient ? { klientId: klient.id, adminId: viewer.id } : null;
}

export async function pozvatDoKlientskeCasti(idRaw: string): Promise<VysledekPozvanky> {
  const overeno = await overKlienta(idRaw);
  if (!overeno) return { ok: false, chyba: "Takový klient neexistuje." };
  // Nová pozvánka by zneplatnila známé heslo ukázkového klienta.
  if (await jeChranenaKarta(overeno.klientId)) return { ok: false, chyba: CHRANENA_KARTA };

  const vysledek = await pozviKlienta(overeno.klientId, overeno.adminId);
  revalidatePath(`/klienti/${overeno.klientId}`);
  return vysledek;
}

export async function zrusitKlientskouCast(idRaw: string): Promise<VysledekPozvanky> {
  const overeno = await overKlienta(idRaw);
  if (!overeno) return { ok: false, chyba: "Takový klient neexistuje." };
  if (await jeChranenaKarta(overeno.klientId)) return { ok: false, chyba: CHRANENA_KARTA };

  const vysledek = await zrusUcetKlienta(overeno.klientId, overeno.adminId);
  revalidatePath(`/klienti/${overeno.klientId}`);
  return vysledek;
}
