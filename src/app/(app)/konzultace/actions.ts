"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import {
  ChybaKonzultace,
  NEJVIC_OPAKOVANI,
  stavKonzultaci,
  zarezervujKonzultaci,
  zrusKonzultaciAdminem,
} from "@/lib/konzultace";
import { prectiOkamzik } from "@/lib/obdobi";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin, requireViewer } from "@/lib/session";

/**
 * Termíny konzultací v CRM (Fáze 5B, Jakub 19. 10. 2026). **Vypisuje,
 * maže a rezervace ruší jen administrátor** (`requireAdmin()`), vidí
 * každý přihlášený. Rezervuje si klient sám v klientské části, nebo za něj
 * kdokoli z týmu — jen s volnou zaplacenou konzultací.
 */

export type VysledekKonzultace = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);
const TYDEN_MS = 7 * 24 * 60 * 60_000;

function obnov(clientId?: string) {
  revalidatePath("/konzultace");
  revalidatePath("/ucet/konzultace");
  revalidatePath("/ucet");
  if (clientId) revalidatePath(`/klienti/${clientId}`);
}

const terminSchema = z.object({
  startsAt: z.string().trim().max(20),
  durationMinutes: z.coerce
    .number({ error: "Délka musí být číslo." })
    .int("Délka musí být celé číslo minut.")
    .min(15, "Konzultace trvá aspoň 15 minut.")
    .max(240, "Konzultace trvá nejvýš 4 hodiny."),
  place: z.string().trim().max(200, "Místo je příliš dlouhé."),
  joinUrl: z
    .string()
    .trim()
    .max(500, "Odkaz je příliš dlouhý.")
    .refine((odkaz) => odkaz === "" || /^https:\/\/[^\s]+$/.test(odkaz), {
      message: "Odkaz na připojení musí začínat https://.",
    }),
  hostId: z.string().trim().max(64),
  opakovat: z.coerce
    .number({ error: "Počet týdnů musí být číslo." })
    .int("Počet týdnů musí být celé číslo.")
    .min(1, "Termín se vypíše aspoň jednou.")
    .max(NEJVIC_OPAKOVANI, `Najednou jde vypsat nejvýš ${NEJVIC_OPAKOVANI} týdnů.`),
});

/**
 * Vypíše termín — a když je `opakovat` víc než 1, i stejný čas v dalších
 * týdnech („každé úterý ve 14:00“). Čas se bere jako pražský a drží se
 * i přes změnu letního času.
 */
export async function vypisTerminy(formData: FormData): Promise<VysledekKonzultace> {
  const admin = await requireAdmin();

  const vstup = terminSchema.safeParse({
    startsAt: formData.get("startsAt") ?? "",
    durationMinutes: formData.get("durationMinutes") ?? "",
    place: formData.get("place") ?? "",
    joinUrl: formData.get("joinUrl") ?? "",
    hostId: formData.get("hostId") ?? "",
    opakovat: formData.get("opakovat") ?? "1",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { durationMinutes, place, joinUrl, opakovat } = vstup.data;

  const prvni = prectiOkamzik(vstup.data.startsAt);
  if (!prvni) return { ok: false, chyba: "Zadej datum a čas začátku." };
  if (prvni <= new Date()) return { ok: false, chyba: "Začátek musí být v budoucnu." };

  // Stejný pražský čas v dalších týdnech — přičíst 7 dní k textu z formuláře,
  // ne k okamžiku, jinak by se po změně času posunul o hodinu.
  const [den, cas] = vstup.data.startsAt.split("T");
  const zaklad = new Date(`${den}T00:00:00Z`);
  const zacatky: Date[] = [];
  for (let tyden = 0; tyden < opakovat; tyden += 1) {
    const datum = new Date(zaklad.getTime() + tyden * TYDEN_MS).toISOString().slice(0, 10);
    const okamzik = prectiOkamzik(`${datum}T${cas}`);
    if (okamzik) zacatky.push(okamzik);
  }

  let hostId: string | null = null;
  if (vstup.data.hostId) {
    const clovek = await db.user.findFirst({
      where: { id: vstup.data.hostId, active: true, deletedAt: null },
      select: { id: true },
    });
    if (!clovek) return { ok: false, chyba: "Takový člen týmu neexistuje." };
    hostId = clovek.id;
  }

  await db.$transaction(async (tx) => {
    for (const startsAt of zacatky) {
      const termin = await tx.consultationSlot.create({
        data: {
          startsAt,
          durationMinutes,
          place: place || null,
          joinUrl: joinUrl || null,
          hostId,
        },
        select: { id: true },
      });
      await zapisDoAuditu(tx, {
        userId: admin.id,
        entity: "consultation_slots",
        entityId: termin.id,
        action: "konzultace.termin-vypsan",
        after: { startsAt: startsAt.toISOString(), durationMinutes, hostId },
      });
    }
  });

  obnov();
  return {
    ok: true,
    zprava:
      zacatky.length === 1
        ? `Termín je vypsaný: ${formatDatumCas(zacatky[0]!)}.`
        : `Vypsané termíny: ${zacatky.length}, první ${formatDatumCas(zacatky[0]!)}.`,
  };
}

/** Smaže volný termín. Termín s platnou rezervací se nejdřív musí zrušit. */
export async function smazTermin(idRaw: string): Promise<VysledekKonzultace> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const termin = await db.consultationSlot.findFirst({
    where: { id: id.data, deletedAt: null },
    select: { id: true, startsAt: true },
  });
  if (!termin) return { ok: false, chyba: "Takový termín neexistuje." };

  const smazano = await db.$transaction(async (tx) => {
    // Podmíněně — mezitím si ho mohl někdo zarezervovat.
    const zmena = await tx.consultationSlot.updateMany({
      where: { id: termin.id, deletedAt: null, activeBookingId: null },
      data: { deletedAt: new Date() },
    });
    if (zmena.count === 0) return false;
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "consultation_slots",
      entityId: termin.id,
      action: "konzultace.termin-smazan",
      before: { startsAt: termin.startsAt.toISOString() },
    });
    return true;
  });
  if (!smazano) {
    return {
      ok: false,
      chyba: "Termín má rezervaci. Nejdřív ji zruš — klient dostane upozornění.",
    };
  }

  obnov();
  return { ok: true, zprava: `Termín je smazaný: ${formatDatumCas(termin.startsAt)}.` };
}

/**
 * Zruší rezervaci klienta — kdykoli, i méně než 24 hodin předem. Klient
 * dostane upozornění a konzultace se mu vrátí; termín je zase volný.
 */
export async function zrusRezervaci(idRaw: string): Promise<VysledekKonzultace> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  try {
    const zruseno = await zrusKonzultaciAdminem(admin.id, id.data);
    obnov(zruseno.clientId);
    return { ok: true, zprava: `Rezervace je zrušená: ${zruseno.jmeno}.` };
  } catch (chyba) {
    if (chyba instanceof ChybaKonzultace) return { ok: false, chyba: chyba.message };
    throw chyba;
  }
}

/**
 * Rezervace za klienta, který zavolá (Jakub, 19. 10. 2026): **smí každý
 * přihlášený**, ale jen klientovi s volnou zaplacenou konzultací — stejné
 * pravidlo jako v klientské části. Klient dostane potvrzení.
 */
export async function zarezervujKlientovi(formData: FormData): Promise<VysledekKonzultace> {
  const viewer = await requireViewer();
  const vstup = z
    .object({ slotId: ID, clientId: z.string().trim().min(1, "Vyber klienta.").max(64) })
    .safeParse({ slotId: formData.get("slotId"), clientId: formData.get("clientId") ?? "" });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const klient = await db.client.findFirst({
    where: { AND: [{ id: vstup.data.clientId, mergedIntoId: null }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
  if ((await stavKonzultaci(klient.id)).zbyva < 1) {
    return { ok: false, chyba: `Klient nemá volnou zaplacenou konzultaci: ${klient.name}.` };
  }

  try {
    const kdy = await zarezervujKonzultaci(klient.id, vstup.data.slotId, viewer.id);
    obnov(klient.id);
    return { ok: true, zprava: `Zarezervováno: ${klient.name}, ${formatDatumCas(kdy)}.` };
  } catch (chyba) {
    if (chyba instanceof ChybaKonzultace) return { ok: false, chyba: chyba.message };
    throw chyba;
  }
}
