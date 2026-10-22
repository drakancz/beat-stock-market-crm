"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniKlienta } from "@/lib/klient/oznameni";
import { requireAdmin, requireViewer } from "@/lib/session";
import { MAX_ODPOVED } from "@/lib/vzdelavani/dotazy";

/**
 * Dotazy u lekcí — strana týmu (Fáze 5C, Jakub 18. 10. 2026).
 *
 * **Odpovědět (i opravit odpověď) smí každý přihlášený, smazat jen
 * administrátor.** Klient dostane o odpovědi upozornění (oznámení, jinak
 * e-mail) bez obsahu — odpověď najde u lekce. Audit bez textu.
 */

export type VysledekDotazu = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

export async function odpovezNaDotaz(idRaw: string, textRaw: string): Promise<VysledekDotazu> {
  const viewer = await requireViewer();
  const vstup = z
    .object({
      id: ID,
      text: z
        .string()
        .trim()
        .min(1, "Napiš odpověď.")
        .max(MAX_ODPOVED, `Odpověď může mít nejvýš ${MAX_ODPOVED} znaků.`),
    })
    .safeParse({ id: idRaw, text: textRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const dotaz = await db.lessonQuestion.findFirst({
    where: { id: vstup.data.id, deletedAt: null, client: { deletedAt: null } },
    select: { id: true, clientId: true, lessonId: true, answeredAt: true },
  });
  if (!dotaz) return { ok: false, chyba: "Takový dotaz neexistuje." };
  const prvniOdpoved = !dotaz.answeredAt;

  await db.$transaction(async (tx) => {
    await tx.lessonQuestion.update({
      where: { id: dotaz.id },
      data: { answer: vstup.data.text, answeredAt: new Date(), answeredById: viewer.id },
    });
    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "lesson_questions",
      entityId: dotaz.id,
      action: "dotaz.zodpovezen",
      after: { klient: dotaz.clientId, ...(prvniOdpoved ? {} : { oprava: true }) },
    });
  });

  // Upozornění jen u první odpovědi — oprava překlepu nemá klienta budit.
  if (prvniOdpoved) {
    await upozorniKlienta(dotaz.clientId, {
      nadpis: "Odpověděli jsme na váš dotaz",
      text: "Odpověď najdete u lekce v klientské části.",
      odkaz: `/ucet/lekce/${dotaz.lessonId}`,
      znacka: `dotaz-${dotaz.id}`,
      odstavceEmailu: [
        "Dobrý den, na váš dotaz k lekci jsme odpověděli.",
        "Odpověď najdete v klientské části přímo u lekce.",
      ],
    });
  }

  revalidatePath("/vzdelavani/dotazy");
  revalidatePath("/vzdelavani", "layout");
  return { ok: true, zprava: prvniOdpoved ? "Odpověď je odeslaná." : "Odpověď je opravená." };
}

export async function smazDotaz(idRaw: string): Promise<VysledekDotazu> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const dotaz = await db.lessonQuestion.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!dotaz) return { ok: false, chyba: "Takový dotaz neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.lessonQuestion.update({ where: { id: dotaz.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "lesson_questions",
      entityId: dotaz.id,
      action: "dotaz.smazan",
      after: { klient: dotaz.clientId },
    });
  });

  revalidatePath("/vzdelavani/dotazy");
  revalidatePath("/vzdelavani", "layout");
  return { ok: true, zprava: "Smazáno: dotaz." };
}
