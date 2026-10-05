"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniNaPristup } from "@/lib/klient/oznameni";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";

import type { Vysledek } from "./actions";

const ID = z.string().trim().min(1).max(64);
const PRISTUPY = z.enum(["NEPOVOLEN", "POVOLEN"]);

/**
 * Povolení nebo odebrání přístupu do programu klientovi.
 * **Jen administrátor** (Jakub, 23. 9. 2026) — jde o přístup k placenému
 * obsahu. Hlídá to `requireAdmin()`, ne skrytý výběr v seznamu.
 *
 * Do 23. 9. 2026 se přístup přepínal u každé objednávky v sekci
 * Objednávky; od té doby je jeden za klienta a přepíná se v seznamu
 * klientů.
 *
 * Zatím je to jen evidence — žádný systém se podle toho neotevírá.
 * Poskytování přístupu bude samostatný projekt.
 */
export async function zmenPristupKlienta(idRaw: string, pristupRaw: string): Promise<Vysledek> {
  const viewer = await requireAdmin();

  const id = ID.safeParse(idRaw);
  const pristup = PRISTUPY.safeParse(pristupRaw);
  if (!id.success || !pristup.success) return { ok: false, chyba: "Neplatný požadavek." };

  const klient = await db.client.findFirst({
    where: { AND: [{ id: id.data }, viditelniKlienti(viewer)] },
    select: { id: true, name: true, programAccess: true },
  });

  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
  if (klient.programAccess === pristup.data) {
    return { ok: true, zprava: "Přístup už takhle nastavený je." };
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: klient.id },
      data: { programAccess: pristup.data },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: klient.id,
      action: "klient.pristup-zmenen",
      before: { pristup: klient.programAccess },
      after: { pristup: pristup.data },
    });
  });

  // Povolený přístup — klient dostane upozornění (3A, 4. 10. 2026).
  // Odebrání se neoznamuje.
  if (pristup.data === "POVOLEN") after(() => upozorniNaPristup(klient.id));

  revalidatePath("/klienti");
  revalidatePath(`/klienti/${klient.id}`);

  return {
    ok: true,
    zprava:
      pristup.data === "POVOLEN"
        ? `Přístup do programu je povolený: ${klient.name}.`
        : `Přístup do programu je odebraný: ${klient.name}.`,
  };
}
