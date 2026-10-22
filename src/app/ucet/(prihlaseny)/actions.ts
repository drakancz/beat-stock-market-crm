"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { odhlasKlienta, requireKlient } from "@/lib/klient/sezeni";
import { odkazNaPlatbu } from "@/lib/platby/platby";

/** Odhlášení z klientské části. Přihlášení týmu se nedotkne. */
export async function odhlasitKlienta(): Promise<void> {
  await odhlasKlienta();
  redirect("/ucet/prihlaseni");
}

/**
 * Zaplacení vlastní nezaplacené objednávky přes bránu GoPay (19. 10. 2026).
 * **Jen svou** — objednávka se hledá s `clientId` z přihlášení. Vrátí adresu
 * platební stránky, prohlížeč klienta na ni přejde.
 */
export async function zaplatitObjednavku(
  orderIdRaw: string,
): Promise<{ ok: true; adresa: string } | { ok: false; chyba: string }> {
  const klient = await requireKlient();
  const id = z.string().trim().min(1).max(64).safeParse(orderIdRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const objednavka = await db.order.findFirst({
    where: {
      id: id.data,
      clientId: klient.clientId,
      deletedAt: null,
      status: { in: ["NOVA", "NEZAPLACENO"] },
    },
    select: { id: true },
  });
  if (!objednavka) return { ok: false, chyba: "Tahle objednávka se zaplatit nedá." };

  try {
    const adresa = await odkazNaPlatbu(objednavka.id);
    if (!adresa) return { ok: false, chyba: "Online platba teď není k dispozici." };
    return { ok: true, adresa };
  } catch {
    return {
      ok: false,
      chyba: "Platební bránu se nepodařilo zastihnout. Zkuste to prosím za chvíli.",
    };
  }
}
