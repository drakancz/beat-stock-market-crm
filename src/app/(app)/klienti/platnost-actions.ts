"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { denSchema } from "@/lib/obdobi";
import { prepocitejPlatnost } from "@/lib/platnost";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import { maPlatnost } from "@/lib/types";

import type { Vysledek } from "./actions";

const ID = z.string().trim().min(1).max(64);

/**
 * Ruční úprava konce platnosti produktu u klienta (Jakub, 24. 9. 2026).
 *
 * **Jen administrátor** — typicky prodloužení zdarma jako omluva. Hlídá
 * to `requireAdmin()`, ne skryté tlačítko na kartě. Vidět platnost smí
 * každý přihlášený.
 *
 * Zadané datum přebije zaplacení, která přišla před úpravou; na zaplacení
 * po ní se dál navazuje (`spocitejKonec()` v `src/lib/platnost.ts`).
 * Datum v minulosti je dovolené — tak se platnost ukončí.
 */
export async function upravPlatnost(
  klientIdRaw: string,
  produktIdRaw: string,
  denRaw: string,
): Promise<Vysledek> {
  const viewer = await requireAdmin();

  const klientId = ID.safeParse(klientIdRaw);
  const produktId = ID.safeParse(produktIdRaw);
  if (!klientId.success || !produktId.success) return { ok: false, chyba: "Neplatný požadavek." };

  const den = denSchema.safeParse(denRaw);
  if (!den.success) return { ok: false, chyba: "Zadej platné datum konce." };

  const [klient, produkt] = await Promise.all([
    db.client.findFirst({
      where: { AND: [{ id: klientId.data }, viditelniKlienti(viewer)] },
      select: { id: true, name: true },
    }),
    db.product.findUnique({
      where: { id: produktId.data },
      select: { id: true, name: true, kind: true },
    }),
  ]);

  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
  if (!produkt) return { ok: false, chyba: "Takový produkt neexistuje." };
  // Kurz platí napořád, konzultace je jednorázová — konec se nenastavuje.
  if (!maPlatnost(produkt.kind)) {
    return { ok: false, chyba: "U kurzu a konzultace se platnost neupravuje." };
  }

  const puvodni = await db.productValidity.findUnique({
    where: { clientId_productId: { clientId: klient.id, productId: produkt.id } },
    select: { validUntil: true },
  });

  await db.$transaction(async (tx) => {
    await tx.productValidity.upsert({
      where: { clientId_productId: { clientId: klient.id, productId: produkt.id } },
      create: {
        clientId: klient.id,
        productId: produkt.id,
        manualUntil: den.data,
        manualAt: new Date(),
      },
      update: { manualUntil: den.data, manualAt: new Date() },
    });

    // Konec se nikdy nepíše rovnou — spočítá se z úpravy i z plateb.
    await prepocitejPlatnost(tx, klient.id);

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: klient.id,
      action: "platnost.upravena",
      before: {
        produkt: produkt.name,
        konec: puvodni?.validUntil ? formatDatum(puvodni.validUntil) : null,
      },
      after: { produkt: produkt.name, konec: formatDatum(den.data) },
    });
  });

  revalidatePath("/klienti");
  revalidatePath(`/klienti/${klient.id}`);
  revalidatePath("/dashboard");

  return {
    ok: true,
    zprava: `${produkt.name} platí do ${formatDatum(den.data)}.`,
  };
}
