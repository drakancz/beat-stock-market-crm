"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { posliOsobniEmail } from "@/lib/email";
import { LIMIT_ZA_HODINU, MAX_PREDMET, MAX_TEXT, type StavEmailu } from "@/lib/email-z-karty";
import { viditelniKlienti } from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Osobní e-mail klientovi z karty (Fáze 5D, Jakub 5. 11. 2026).
 *
 * - **Poslat smí každý přihlášený** (`requireViewer()`), kdo kartu vidí —
 *   klient se hledá s podmínkou viditelnosti (`viditelniKlienti()`).
 * - **I bez souhlasu s marketingem** — osobní zpráva, ne kampaň (Jakub
 *   5. 11. 2026); okno na chybějící souhlas upozorní.
 * - Nejvýš `LIMIT_ZA_HODINU` e-mailů za hodinu na člověka.
 * - Zpráva se nejdřív uloží (`client_emails`) a audit jde ve stejné
 *   transakci — **bez předmětu a textu** (pravidlo 8). Odeslání až potom;
 *   když selže, zůstane v historii jako neodeslaná a chyba je v Chybách.
 * - V ukázce se nic neodešle (`posliOsobniEmail()` → `nactiNastaveniPosty()`).
 */

export type VysledekEmailu = { ok: true; zprava: string } | { ok: false; chyba: string };

const vstupSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  predmet: z
    .string()
    .trim()
    .min(1, "Napiš předmět e-mailu.")
    .max(MAX_PREDMET, `Předmět může mít nejvýš ${MAX_PREDMET} znaků.`),
  text: z
    .string()
    .trim()
    .min(1, "Napiš text e-mailu.")
    .max(MAX_TEXT, `Text může mít nejvýš ${MAX_TEXT} znaků.`),
});

export async function posliEmailKlientovi(
  clientIdRaw: string,
  predmetRaw: string,
  textRaw: string,
): Promise<VysledekEmailu> {
  const viewer = await requireViewer();

  const vstup = vstupSchema.safeParse({
    clientId: clientIdRaw,
    predmet: predmetRaw,
    text: textRaw,
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { clientId, predmet, text } = vstup.data;

  const klient = await db.client.findFirst({
    where: { AND: [{ id: clientId }, viditelniKlienti(viewer)] },
    select: { id: true, name: true, email: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const odeslanoZaHodinu = await db.clientEmail.count({
    where: { authorId: viewer.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (odeslanoZaHodinu >= LIMIT_ZA_HODINU) {
    return {
      ok: false,
      chyba: `Z tvého účtu už za poslední hodinu odešlo ${LIMIT_ZA_HODINU} e-mailů, víc najednou nejde. Hromadné zprávy patří do SmartEmailingu.`,
    };
  }

  const ulozeny = await db.$transaction(async (tx) => {
    const email = await tx.clientEmail.create({
      data: {
        clientId: klient.id,
        authorId: viewer.id,
        subject: predmet,
        body: text,
        status: "NEODESLANO" satisfies StavEmailu,
      },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: klient.id,
      action: "klient.email-odeslan",
      after: { klient: klient.name, email: email.id },
    });
    return email;
  });

  const vysledek = await posliOsobniEmail({
    komu: klient.email,
    predmet,
    text,
    autor: { jmeno: viewer.name, email: viewer.email },
    clientId: klient.id,
    spustilId: viewer.id,
  });

  if (vysledek.odeslano) {
    await db.clientEmail.update({
      where: { id: ulozeny.id },
      data: { status: "ODESLANO" satisfies StavEmailu },
    });
  }
  revalidatePath(`/klienti/${klient.id}`);

  if (vysledek.odeslano) return { ok: true, zprava: `E-mail odešel: ${klient.name}.` };
  if (jeUkazka()) {
    return {
      ok: true,
      zprava: "V ukázce se e-maily neodesílají. Zpráva je uložená v historii jako neodeslaná.",
    };
  }
  return {
    ok: false,
    chyba:
      vysledek.duvod === "nenastaveno"
        ? "E-mail neodešel — na serveru není nastavené odesílání pošty. Zpráva zůstala v historii jako neodeslaná."
        : "E-mail se nepodařilo odeslat. Zpráva zůstala v historii jako neodeslaná, podrobnosti vidí administrátor v sekci Chyby.",
  };
}
