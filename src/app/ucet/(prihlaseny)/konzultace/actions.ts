"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { formatDatumCas } from "@/lib/format";
import {
  ChybaKonzultace,
  prelozKonzultaci,
  zarezervujKonzultaci,
  zrusKonzultaciKlientem,
} from "@/lib/konzultace";
import { requireKlient } from "@/lib/klient/sezeni";

/**
 * Rezervace konzultace klientem (Fáze 5B, Jakub 19. 10. 2026). **Jen sám
 * za sebe** — `clientId` vždy z přihlášení, nikdy z prohlížeče. Kolik
 * konzultací má zaplaceno a jestli je ještě 24 hodin do začátku, hlídá
 * `src/lib/konzultace.ts`.
 */

export type VysledekRezervace = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

function obnov(clientId: string) {
  revalidatePath("/ucet/konzultace");
  revalidatePath("/ucet");
  revalidatePath("/konzultace");
  revalidatePath(`/klienti/${clientId}`);
}

async function proved(clientId: string, krok: () => Promise<string>): Promise<VysledekRezervace> {
  try {
    const zprava = await krok();
    obnov(clientId);
    return { ok: true, zprava };
  } catch (chyba) {
    if (chyba instanceof ChybaKonzultace) return { ok: false, chyba: chyba.message };
    throw chyba;
  }
}

export async function zarezervuj(slotIdRaw: string): Promise<VysledekRezervace> {
  const klient = await requireKlient();
  const slotId = ID.safeParse(slotIdRaw);
  if (!slotId.success) return { ok: false, chyba: "Neplatný požadavek." };

  return proved(klient.clientId, async () => {
    const kdy = await zarezervujKonzultaci(klient.clientId, slotId.data);
    return `Konzultace je zarezervovaná: ${formatDatumCas(kdy)}.`;
  });
}

export async function zrus(bookingIdRaw: string): Promise<VysledekRezervace> {
  const klient = await requireKlient();
  const bookingId = ID.safeParse(bookingIdRaw);
  if (!bookingId.success) return { ok: false, chyba: "Neplatný požadavek." };

  return proved(klient.clientId, async () => {
    const kdy = await zrusKonzultaciKlientem(klient.clientId, bookingId.data);
    return `Rezervace je zrušená: ${formatDatumCas(kdy)}. Konzultace vám zůstává.`;
  });
}

export async function preloz(bookingIdRaw: string, slotIdRaw: string): Promise<VysledekRezervace> {
  const klient = await requireKlient();
  const vstup = z
    .object({ bookingId: ID, slotId: ID })
    .safeParse({ bookingId: bookingIdRaw, slotId: slotIdRaw });
  if (!vstup.success) return { ok: false, chyba: "Vyberte nový termín." };

  return proved(klient.clientId, async () => {
    const kdy = await prelozKonzultaci(klient.clientId, vstup.data.bookingId, vstup.data.slotId);
    return `Konzultace je přeložená na ${formatDatumCas(kdy)}.`;
  });
}
