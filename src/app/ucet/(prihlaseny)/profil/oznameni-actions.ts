"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  jePovolenaAdresa,
  MAX_ZARIZENI,
  popisZarizeni,
  posliZkusebniOznameni,
} from "@/lib/klient/oznameni";
import { requireKlient } from "@/lib/klient/sezeni";
import { vytvorPocitadlo } from "@/lib/verejne-api";

/**
 * Oznámení v Mém profilu klienta (krok 3A, Jakub 4. 10. 2026).
 *
 * **Klient mění jen sám sebe** — `requireKlient()` je první řádek každé
 * akce a účet se bere z přihlášení, nikdy z formuláře.
 *
 * - Vypínač upozornění platí pro celý účet (oznámení i náhradní e-mail).
 * - Zařízení se ukládá, když klient v prohlížeči povolí oznámení. Adresa
 *   musí patřit doručovací službě prohlížeče (`jePovolenaAdresa()`).
 */

export type VysledekOznameni = { ok: true; zprava?: string } | { ok: false; chyba: string };

/* ---------- Vypínač ---------- */

export async function nastavUpozorneni(zapnoutRaw: boolean): Promise<VysledekOznameni> {
  const klient = await requireKlient();

  const zapnout = z.boolean().safeParse(zapnoutRaw);
  if (!zapnout.success) return { ok: false, chyba: "Neplatný požadavek." };

  await db.$transaction(async (tx) => {
    await tx.clientAccount.update({
      where: { id: klient.accountId },
      data: { notificationsEnabled: zapnout.data },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: klient.clientId,
      action: "klient.ucet-oznameni",
      after: { klient: klient.name, zapnuto: zapnout.data },
    });
  });

  revalidatePath("/ucet/profil");
  return {
    ok: true,
    zprava: zapnout.data ? "Upozornění jsou zapnutá." : "Upozornění jsou vypnutá.",
  };
}

/* ---------- Zařízení ---------- */

const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/);

/** Přihlášení zařízení tak, jak ho vrátí prohlížeč (`PushSubscription.toJSON()`). */
const zarizeniVstup = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    // Veřejný klíč P-256 má 65 bajtů (87 znaků), tajemství 16 bajtů (22 znaků).
    p256dh: base64url(80, 100),
    auth: base64url(16, 40),
  }),
});

export async function ulozZarizeni(vstupRaw: unknown): Promise<VysledekOznameni> {
  const klient = await requireKlient();

  const vstup = zarizeniVstup.safeParse(vstupRaw);
  if (!vstup.success || !jePovolenaAdresa(vstup.data.endpoint)) {
    return { ok: false, chyba: "Tenhle prohlížeč oznámení nepodporuje." };
  }
  const { endpoint, keys } = vstup.data;
  const device = popisZarizeni((await headers()).get("user-agent"));

  await db.$transaction(async (tx) => {
    // Stejné zařízení po přihlášení jiného klienta patří tomu novému —
    // oznámení se mají ukazovat tomu, kdo je v telefonu přihlášený.
    await tx.clientPushSubscription.upsert({
      where: { endpoint },
      create: {
        accountId: klient.accountId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        device,
      },
      update: { accountId: klient.accountId, p256dh: keys.p256dh, auth: keys.auth, device },
    });

    // Nejvýš `MAX_ZARIZENI` na účet — nejstarší nad limit se zapomenou.
    const nadLimit = await tx.clientPushSubscription.findMany({
      where: { accountId: klient.accountId },
      orderBy: { createdAt: "desc" },
      skip: MAX_ZARIZENI,
      select: { id: true },
    });
    if (nadLimit.length > 0) {
      await tx.clientPushSubscription.deleteMany({
        where: { id: { in: nadLimit.map((z) => z.id) } },
      });
    }
  });

  revalidatePath("/ucet/profil");
  return { ok: true, zprava: "Oznámení jsou na tomhle zařízení povolená." };
}

export async function odeberZarizeni(endpointRaw: string): Promise<VysledekOznameni> {
  const klient = await requireKlient();

  const endpoint = z.string().trim().min(1).max(2048).safeParse(endpointRaw);
  if (!endpoint.success) return { ok: false, chyba: "Neplatný požadavek." };

  // Jen vlastní zařízení — podmínka na účet je v dotazu.
  await db.clientPushSubscription.deleteMany({
    where: { endpoint: endpoint.data, accountId: klient.accountId },
  });

  revalidatePath("/ucet/profil");
  return { ok: true, zprava: "Na tomhle zařízení oznámení nepřijdou." };
}

/* ---------- Zkouška ---------- */

/** Zkušební oznámení: nejvýš 3 za minutu na účet, ať se z tlačítka nestane spam. */
const prilisCasto = vytvorPocitadlo({ limit: 3, oknoMs: 60_000 });

export async function zkusOznameni(): Promise<VysledekOznameni> {
  const klient = await requireKlient();

  if (prilisCasto(klient.accountId)) {
    return { ok: false, chyba: "Zkušební oznámení jde poslat nejvýš třikrát za minutu." };
  }

  const dorazilo = await posliZkusebniOznameni(klient.accountId);
  if (dorazilo === 0) {
    return {
      ok: false,
      chyba:
        "Oznámení se nepodařilo doručit. Zkuste je na tomhle zařízení vypnout a znovu povolit.",
    };
  }
  return { ok: true, zprava: "Zkušební oznámení je na cestě." };
}
