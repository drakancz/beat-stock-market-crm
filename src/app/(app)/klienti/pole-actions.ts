"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { nactiPole } from "@/lib/vlastni-pole";
import { prectiHodnotu } from "@/lib/vlastni-pole-druhy";

/**
 * Hodnoty vlastních polí u klienta (Fáze 5B, Jakub 18. 10. 2026).
 *
 * **Vyplnit a změnit smí každý přihlášený**, kdo vidí kartu (klient se
 * hledá s `viditelniKlienti()`). Seznam polí spravuje administrátor
 * v Nastavení. Pole přijdou jako `pole-<id>`; neznámá a smazaná se
 * ignorují. Do auditu jdou jen názvy změněných polí, ne hodnoty.
 */

export type VysledekPoli = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

export async function ulozVlastniPole(
  klientIdRaw: string,
  formData: FormData,
): Promise<VysledekPoli> {
  const viewer = await requireViewer();
  const klientId = ID.safeParse(klientIdRaw);
  if (!klientId.success) return { ok: false, chyba: "Neplatný požadavek." };

  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId.data }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const [pole, dosavadni] = await Promise.all([
    nactiPole(),
    db.clientFieldValue.findMany({
      where: { clientId: klient.id },
      select: { fieldId: true, value: true },
    }),
  ]);
  const puvodni = new Map(dosavadni.map((h) => [h.fieldId, h.value]));

  const zmeny: { fieldId: string; nazev: string; hodnota: string | null }[] = [];
  for (const p of pole) {
    const vstup = formData.get(`pole-${p.id}`);
    if (typeof vstup !== "string") continue;
    const prectene = prectiHodnotu(p, vstup.slice(0, 1_000));
    if ("chyba" in prectene) return { ok: false, chyba: prectene.chyba };
    if (prectene.hodnota !== (puvodni.get(p.id) ?? null)) {
      zmeny.push({ fieldId: p.id, nazev: p.name, hodnota: prectene.hodnota });
    }
  }
  if (zmeny.length === 0) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    for (const zmena of zmeny) {
      const klic = { clientId_fieldId: { clientId: klient.id, fieldId: zmena.fieldId } };
      if (zmena.hodnota === null) {
        await tx.clientFieldValue.deleteMany({
          where: { clientId: klient.id, fieldId: zmena.fieldId },
        });
      } else {
        await tx.clientFieldValue.upsert({
          where: klic,
          create: {
            clientId: klient.id,
            fieldId: zmena.fieldId,
            value: zmena.hodnota,
            updatedById: viewer.id,
          },
          update: { value: zmena.hodnota, updatedById: viewer.id },
        });
      }
    }
    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: klient.id,
      action: "klient.pole-zmeneno",
      // Jen názvy polí — hodnota může být cokoli, co tým napíše.
      after: { pole: zmeny.map((zmena) => zmena.nazev) },
    });
  });

  revalidatePath(`/klienti/${klient.id}`);
  revalidatePath("/klienti");
  return { ok: true, zprava: `Uloženo: ${zmeny.map((zmena) => zmena.nazev).join(", ")}.` };
}
