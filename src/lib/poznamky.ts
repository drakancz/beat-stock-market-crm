import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";

/**
 * Zápis poznámky u klienta — společný pro okno Poznámky v CRM
 * (`klienti/poznamky-actions.ts`) a pro AI přes MCP (Jakub, 5. 10. 2026).
 *
 * Kontrola i audit jsou na jednom místě, takže AI platí přesně stejná
 * pravidla jako člověk v CRM: klient musí být v rozsahu přihlášeného,
 * text má omezenou délku a do auditu jde jen to, že poznámka přibyla —
 * **nikdy obsah** (security_warnings.md, pravidlo 8).
 */

/** Nejdelší poznámka. Poznámka je zápis, ne dokument. */
const MAX_DELKA = 5000;

export const textPoznamkySchema = z
  .string()
  .trim()
  .min(1, "Napiš text poznámky.")
  .max(MAX_DELKA, "Poznámka je příliš dlouhá.");

const idSchema = z.string().trim().min(1).max(64);

export type VysledekZapisu =
  { ok: true; id: string; klientId: string } | { ok: false; chyba: string };

export async function zapisPoznamku(
  viewer: Viewer,
  klientIdRaw: unknown,
  textRaw: unknown,
  { presMcp = false }: { presMcp?: boolean } = {},
): Promise<VysledekZapisu> {
  const klientId = idSchema.safeParse(klientIdRaw);
  if (!klientId.success) return { ok: false, chyba: "Neplatný klient." };

  const text = textPoznamkySchema.safeParse(textRaw);
  if (!text.success) return { ok: false, chyba: text.error.issues[0].message };

  // Rozsah je v dotazu: na klienta mimo něj se nedostane ani přes adresu.
  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId.data }, viditelniKlienti(viewer)] },
    select: { id: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const poznamka = await db.$transaction(async (tx) => {
    const nova = await tx.clientNote.create({
      data: {
        clientId: klient.id,
        authorId: viewer.id,
        text: text.data,
        createdViaMcp: presMcp,
      },
      select: { id: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "client_notes",
      entityId: nova.id,
      action: "klient.poznamka-pridana",
      after: { clientId: klient.id, ...(presMcp ? { mcp: true } : {}) },
    });

    return nova;
  });

  return { ok: true, id: poznamka.id, klientId: klient.id };
}
