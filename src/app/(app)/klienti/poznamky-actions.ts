"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { textPoznamkySchema, zapisPoznamku } from "@/lib/poznamky";
import { viditelniKlienti } from "@/lib/queries";
import { requireViewer, type Viewer } from "@/lib/session";

import type { Vysledek } from "./actions";

/**
 * Poznámky u klienta — okno Poznámky na kartě (Jakub, 23. 9. 2026).
 *
 * **Oprávnění, jak je Jakub určil:**
 *
 * 1. **Psát smí každý přihlášený**, kdo klienta vidí (dnes všichni).
 * 2. **Opravit a smazat smí autor a administrátor** — stejně jako
 *    u hovorů a příloh. Zápis bez autora (z webu, převod staré poznámky)
 *    tedy mění jen administrátor.
 * 3. **Vždycky přes viditelnost klienta.** Na poznámku u klienta, na
 *    kterého člověk nedosáhne, se nedostane ani přes adresu; odpověď je
 *    stejná jako u neexistujícího záznamu.
 *
 * **Obsah poznámky do auditu nikdy nejde** — bývají v ní osobní údaje
 * (security_warnings.md, pravidlo 8). Audit ví jen, že přibyla, změnila
 * se nebo zmizela, a u kterého klienta.
 *
 * Smazaná poznámka dostane `deletedAt`, řádek zůstává. Do obrazovky
 * Smazané nechodí, stejně jako hovory a úkoly.
 */

const textSchema = textPoznamkySchema;

const idSchema = z.string().trim().min(1).max(64);

/**
 * Poznámka, na kterou přihlášený smí sáhnout: klient v jeho rozsahu
 * **a** poznámka jeho vlastní, ledaže je administrátor.
 */
async function poznamkaKUprave(viewer: Viewer, id: string) {
  const poznamka = await db.clientNote.findFirst({
    where: { AND: [{ id, deletedAt: null }, { client: viditelniKlienti(viewer) }] },
    select: { id: true, authorId: true, clientId: true },
  });

  if (!poznamka) return null;
  if (viewer.role !== "ADMINISTRATOR" && poznamka.authorId !== viewer.id) return null;
  return poznamka;
}

export async function pridejPoznamku(klientIdRaw: string, textRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  // Kontrola i audit jsou ve společné funkci — stejná pravidla platí
  // i pro zápis přes AI (`src/lib/poznamky.ts`).
  const vysledek = await zapisPoznamku(viewer, klientIdRaw, textRaw);
  if (!vysledek.ok) return vysledek;

  revalidatePath(`/klienti/${vysledek.klientId}`);
  return { ok: true, id: vysledek.id, zprava: "Poznámka je zapsaná." };
}

export async function upravPoznamku(idRaw: string, textRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = idSchema.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatná poznámka." };

  const text = textSchema.safeParse(textRaw);
  if (!text.success) return { ok: false, chyba: text.error.issues[0].message };

  const poznamka = await poznamkaKUprave(viewer, id.data);
  if (!poznamka) return { ok: false, chyba: "Taková poznámka neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.clientNote.update({ where: { id: poznamka.id }, data: { text: text.data } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "client_notes",
      entityId: poznamka.id,
      action: "klient.poznamka-upravena",
      after: { clientId: poznamka.clientId },
    });
  });

  revalidatePath(`/klienti/${poznamka.clientId}`);
  return { ok: true, zprava: "Poznámka je opravená." };
}

export async function smazPoznamku(idRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = idSchema.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatná poznámka." };

  const poznamka = await poznamkaKUprave(viewer, id.data);
  if (!poznamka) return { ok: false, chyba: "Taková poznámka neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.clientNote.update({ where: { id: poznamka.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "client_notes",
      entityId: poznamka.id,
      action: "klient.poznamka-smazana",
      before: { clientId: poznamka.clientId },
    });
  });

  revalidatePath(`/klienti/${poznamka.clientId}`);
  return { ok: true, zprava: "Poznámka je smazaná." };
}
