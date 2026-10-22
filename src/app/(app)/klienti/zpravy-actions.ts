"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniKlienta, type Doruceni } from "@/lib/klient/oznameni";
import { viditelniKlienti } from "@/lib/queries";
import { pocet } from "@/lib/mnozne";
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

  return {
    ok: true,
    zprava: POPIS_DORUCENI[await odesliZpravu(admin.id, klient, vstup.data.text)],
  };
}

/** Uloží zprávu, zapíše audit a doručí ji. Společné pro jednu i hromadnou zprávu. */
async function odesliZpravu(
  adminId: string,
  klient: { id: string; name: string },
  text: string,
  hromadne = false,
): Promise<Doruceni> {
  const zprava = await db.$transaction(async (tx) => {
    const ulozena = await tx.clientMessage.create({
      data: { clientId: klient.id, authorId: adminId, text, delivery: "JEN_UCET" },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "clients",
      entityId: klient.id,
      action: "klient.zprava-odeslana",
      after: { klient: klient.name, zprava: ulozena.id, ...(hromadne ? { hromadne: true } : {}) },
    });
    return ulozena;
  });

  // Doručení až po uložení — zpráva nesmí zmizet jen proto, že doručovací
  // služba neodpovídá. Administrátor počká pár sekund a hned ví, jak to dopadlo.
  const doruceni = await upozorniKlienta(klient.id, {
    nadpis: "Zpráva od Beat Stock Market",
    text,
    odkaz: "/ucet/zpravy",
    znacka: `zprava-${zprava.id}`,
    odstavceEmailu: ["Dobrý den, máte od nás novou zprávu:", text],
  });

  await db.clientMessage.update({
    where: { id: zprava.id },
    data: { delivery: doruceni === "BEZ_UCTU" ? "JEN_UCET" : doruceni },
  });

  revalidatePath(`/klienti/${klient.id}`);
  return doruceni;
}

/** Nejvíc klientů v jedné hromadné zprávě — kampaně patří do SmartEmailingu. */
const MAX_HROMADNE_ZPRAVY = 200;

/**
 * Hromadná zpráva vybraným klientům (Fáze 5B, Jakub 11. 10. 2026).
 * **Jen administrátor**, jen klientům s aktivním účtem — ostatní se
 * přeskočí a hláška řekne kolik. Každý klient dostane vlastní zprávu
 * (stejně jako jednotlivá), audit u každého s `hromadne: true`.
 */
export async function posliZpravuVybranym(
  idsRaw: string[],
  textRaw: string,
): Promise<VysledekZpravy> {
  const admin = await requireAdmin();

  const vstup = z
    .object({
      ids: z
        .array(z.string().trim().min(1).max(64))
        .min(1, "Vyber aspoň jednoho klienta.")
        .max(MAX_HROMADNE_ZPRAVY, `Najednou jde poslat nejvýš ${MAX_HROMADNE_ZPRAVY} zpráv.`),
      text: vstupSchema.shape.text,
    })
    .safeParse({ ids: idsRaw, text: textRaw });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const klienti = await db.client.findMany({
    where: {
      AND: [
        { id: { in: vstup.data.ids } },
        viditelniKlienti(admin),
        { ucet: { passwordHash: { not: null }, revokedAt: null } },
      ],
    },
    select: { id: true, name: true },
  });
  if (klienti.length === 0) {
    return { ok: false, chyba: "Nikdo z vybraných nemá aktivní účet v klientské části." };
  }

  let dorazilo = 0;
  for (const klient of klienti) {
    const doruceni = await odesliZpravu(admin.id, klient, vstup.data.text, true);
    if (doruceni === "OZNAMENI" || doruceni === "EMAIL") dorazilo += 1;
  }

  const bezUctu = new Set(vstup.data.ids).size - klienti.length;
  return {
    ok: true,
    zprava:
      `Zpráva je uložená u ${pocet(klienti.length, "klienta", "klientů", "klientů")}` +
      `, oznámením nebo e-mailem dorazila ${dorazilo}.` +
      (bezUctu > 0 ? ` Bez účtu v klientské části přeskočeno: ${bezUctu}.` : ""),
  };
}
