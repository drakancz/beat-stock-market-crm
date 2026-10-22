"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { seradDvojici } from "@/lib/duplicity";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin, requireViewer, type Viewer } from "@/lib/session";
import { CHRANENA_KARTA, jeChranenaKarta } from "@/lib/ukazka-ochrana";
import { sloucKlienty } from "@/lib/slouceni";

import type { Vysledek } from "./actions";

/**
 * Možné duplicity klientů (Jakub, 27. 9. 2026, krok 2B).
 *
 * | Kdo           | Smí                                                    |
 * | ------------- | ------------------------------------------------------ |
 * | uživatel      | vidět návrhy, potvrdit „nejsou stejný člověk“          |
 * | administrátor | navíc **sloučit** dvě karty do jedné                   |
 * | nepřihlášený  | nic                                                    |
 *
 * Sloučení je zásah do historie klienta, proto jen administrátor —
 * hlídá to `requireAdmin()` (404 pro ostatní), ne skryté tlačítko.
 */

const ID = z.string().trim().min(1).max(64);

/** Obě karty mimo Smazané; jinak jako u neexistujícího klienta. */
async function dvaKlienti(viewer: Viewer, prvniRaw: string, druhyRaw: string) {
  const prvni = ID.safeParse(prvniRaw);
  const druhy = ID.safeParse(druhyRaw);
  if (!prvni.success || !druhy.success || prvni.data === druhy.data) return null;

  const klienti = await db.client.findMany({
    where: { AND: [{ id: { in: [prvni.data, druhy.data] } }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });
  const a = klienti.find((klient) => klient.id === prvni.data);
  const b = klienti.find((klient) => klient.id === druhy.data);
  return a && b ? { a, b } : null;
}

function obnovStranky(...klienti: string[]) {
  revalidatePath("/klienti");
  revalidatePath("/klienti/duplicity");
  for (const id of klienti) revalidatePath(`/klienti/${id}`);
  revalidatePath("/objednavky");
  revalidatePath("/smazane");
  revalidatePath("/dashboard");
}

/**
 * Sloučí druhou kartu do první. **Jen administrátor.**
 * Co přesně se přesune, je v `src/lib/slouceni.ts`.
 */
export async function sloucitKlienty(zustavaRaw: string, odchaziRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const dvojice = await dvaKlienti(admin, zustavaRaw, odchaziRaw);
  if (!dvojice) return { ok: false, chyba: "Takové klienty v seznamu nemáme." };
  const { a: zustava, b: odchazi } = dvojice;
  if (await jeChranenaKarta(odchazi.id)) return { ok: false, chyba: CHRANENA_KARTA };

  // Delší lhůta: přesouvá se celá historie a přepočítává platnost.
  const { presunuto } = await db.$transaction(
    (tx) => sloucKlienty(tx, { zustavaId: zustava.id, odchaziId: odchazi.id, adminId: admin.id }),
    { timeout: 30_000 },
  );

  obnovStranky(zustava.id, odchazi.id);

  return {
    ok: true,
    zprava: `Sloučeno do karty ${zustava.name}. Přesunuto objednávek: ${presunuto.objednavek}.`,
  };
}

/**
 * „Nejsou stejný člověk“ — návrh duplicity se už neukáže.
 * Smí každý přihlášený (Jakub, 27. 9. 2026).
 */
export async function oznacitNejsouDuplicita(
  prvniRaw: string,
  druhyRaw: string,
): Promise<Vysledek> {
  const viewer = await requireViewer();

  const dvojice = await dvaKlienti(viewer, prvniRaw, druhyRaw);
  if (!dvojice) return { ok: false, chyba: "Takové klienty v seznamu nemáme." };

  const [clientAId, clientBId] = seradDvojici(dvojice.a.id, dvojice.b.id);

  await db.$transaction(async (tx) => {
    await tx.clientNotDuplicate.upsert({
      where: { clientAId_clientBId: { clientAId, clientBId } },
      create: { clientAId, clientBId, userId: viewer.id },
      update: {},
    });
    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: dvojice.a.id,
      action: "klient.neni-duplicita",
      after: { klienti: [dvojice.a.name, dvojice.b.name] },
    });
  });

  obnovStranky(dvojice.a.id, dvojice.b.id);

  return { ok: true, zprava: "Označeno: nejde o stejného člověka." };
}
