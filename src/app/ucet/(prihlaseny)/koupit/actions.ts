"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireKlient } from "@/lib/klient/sezeni";
import { objednejVKlientskeCasti } from "@/lib/objednavky";
import { spocitejSlevu } from "@/lib/slevove-kody";

/**
 * Nákup v klientské části (Jakub, 20. 10. 2026). **Jen přihlášený klient
 * a jen za sebe** — klient je vždy ten z `requireKlient()`, nikdy id
 * z prohlížeče. Cena se bere z ceníku, slevu počítá CRM
 * (`spocitejSlevu()`), stejně jako u Landing Page.
 */

const ID = z.string().trim().min(1).max(64);
// Prázdný kód = bez slevy. Tvar kódu ověří `spocitejSlevu()`.
const KOD = z.string().trim().max(40);

export type VysledekKodu =
  | { ok: true; kod: string; celkemPredSlevou: number; sleva: number; celkem: number }
  | { ok: false; chyba: string };

/** Ověření slevového kódu před objednáním — nic nezapisuje. */
export async function overKod(productIdRaw: string, kodRaw: string): Promise<VysledekKodu> {
  const klient = await requireKlient();
  const productId = ID.safeParse(productIdRaw);
  const kod = KOD.min(1, "Napište slevový kód.").safeParse(kodRaw);
  if (!productId.success) return { ok: false, chyba: "Neplatný požadavek." };
  if (!kod.success) return { ok: false, chyba: kod.error.issues[0]!.message };

  const produkt = await db.product.findFirst({
    where: { id: productId.data, active: true, deletedAt: null },
    select: { id: true },
  });
  if (!produkt) return { ok: false, chyba: "Tenhle produkt teď v nabídce není." };

  const sleva = await spocitejSlevu(kod.data, [{ productId: produkt.id, quantity: 1 }], {
    klientId: klient.clientId,
  });
  if (!sleva.ok) return { ok: false, chyba: sleva.chyba };
  return {
    ok: true,
    kod: sleva.kod.code,
    celkemPredSlevou: sleva.celkemPredSlevou,
    sleva: sleva.sleva,
    celkem: sleva.celkemPoSleve,
  };
}

export type VysledekNakupu =
  { ok: true; cislo: string; odkazNaPlatbu: string | null } | { ok: false; chyba: string };

/**
 * Objednání jednoho produktu. Vrátí číslo objednávky a případně adresu brány.
 *
 * Bez zaškrtnutého souhlasu s obchodními podmínkami (Jakub, 20. 10. 2026)
 * objednávka nevznikne — hlídá to server, ne jen tlačítko v okně.
 */
export async function objednej(
  productIdRaw: string,
  kodRaw: string,
  souhlasRaw: boolean,
): Promise<VysledekNakupu> {
  const klient = await requireKlient();
  const productId = ID.safeParse(productIdRaw);
  const kod = KOD.safeParse(kodRaw);
  const souhlas = z.boolean().safeParse(souhlasRaw);
  if (!productId.success || !kod.success || !souhlas.success) {
    return { ok: false, chyba: "Neplatný požadavek." };
  }
  if (!souhlas.data) {
    return { ok: false, chyba: "Potvrďte prosím souhlas s obchodními podmínkami." };
  }

  const vysledek = await objednejVKlientskeCasti(klient.clientId, productId.data, kod.data || null);
  if (!vysledek.ok) return { ok: false, chyba: vysledek.chyba };

  revalidatePath("/ucet");
  return { ok: true, cislo: vysledek.cislo, odkazNaPlatbu: vysledek.odkazNaPlatbu ?? null };
}
