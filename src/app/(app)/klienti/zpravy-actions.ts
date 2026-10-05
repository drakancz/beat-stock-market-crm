"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniKlienta, type Doruceni } from "@/lib/klient/oznameni";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";

/**
 * Zpráva od administrátora klientovi (krok 3A, Jakub 4. 10. 2026).
 *
 * **Poslat smí jen administrátor** (`requireAdmin()`), jen klientovi
 * s aktivním účtem v klientské části. Historii na kartě klienta vidí každý
 * přihlášený, klient zprávu najde v `/ucet/zpravy`.
 *
 * Doručení: oznámení na zařízení klienta, a když žádné nemá, e-mail
 * (`upozorniKlienta()`). Když má klient upozornění vypnutá, zprávu uvidí
 * jen po přihlášení.
 *
 * Do auditu jde, že zpráva odešla a jak se doručila — **ne její text**
 * (ten je v `client_messages`, pravidlo 8).
 */

export type VysledekZpravy = { ok: true; zprava: string } | { ok: false; chyba: string };

const vstupSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  text: z
    .string()
    .trim()
    .min(1, "Napiš text zprávy.")
    .max(1000, "Zpráva může mít nejvýš 1000 znaků."),
});

const POPIS_DORUCENI: Record<Doruceni, string> = {
  OZNAMENI: "Zpráva odešla a klientovi přišlo oznámení.",
  EMAIL: "Zpráva odešla. Oznámení klient povolená nemá, přišla mu e-mailem.",
  JEN_UCET:
    "Zpráva je uložená v klientské části. Oznámení ani e-mail klientovi nepřišly — uvidí ji po přihlášení.",
  BEZ_UCTU: "Zpráva je uložená, ale klient účet do klientské části nemá.",
};

export async function posliZpravuKlientovi(
  clientIdRaw: string,
  textRaw: string,
): Promise<VysledekZpravy> {
  const admin = await requireAdmin();

  const vstup = vstupSchema.safeParse({ clientId: clientIdRaw, text: textRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const klient = await db.client.findFirst({
    where: { AND: [{ id: vstup.data.clientId }, viditelniKlienti(admin)] },
    select: {
      id: true,
      name: true,
      ucet: { select: { passwordHash: true, revokedAt: true } },
    },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
  if (!klient.ucet?.passwordHash || klient.ucet.revokedAt) {
    return {
      ok: false,
      chyba: "Klient nemá aktivní účet v klientské části. Nejdřív ho pozvi.",
    };
  }

  const zprava = await db.$transaction(async (tx) => {
    const ulozena = await tx.clientMessage.create({
      data: {
        clientId: klient.id,
        authorId: admin.id,
        text: vstup.data.text,
        delivery: "JEN_UCET",
      },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "clients",
      entityId: klient.id,
      action: "klient.zprava-odeslana",
      after: { klient: klient.name, zprava: ulozena.id },
    });
    return ulozena;
  });

  // Doručení až po uložení — zpráva nesmí zmizet jen proto, že doručovací
  // služba neodpovídá. Administrátor počká pár sekund a hned ví, jak to dopadlo.
  const doruceni = await upozorniKlienta(klient.id, {
    nadpis: "Zpráva od Beat Stock Market",
    text: vstup.data.text,
    odkaz: "/ucet/zpravy",
    znacka: `zprava-${zprava.id}`,
    odstavceEmailu: ["Dobrý den, máte od nás novou zprávu:", vstup.data.text],
  });

  await db.clientMessage.update({
    where: { id: zprava.id },
    data: { delivery: doruceni === "BEZ_UCTU" ? "JEN_UCET" : doruceni },
  });

  revalidatePath(`/klienti/${klient.id}`);
  return { ok: true, zprava: POPIS_DORUCENI[doruceni] };
}
