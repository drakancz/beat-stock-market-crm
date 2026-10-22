"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * Produkty → Doporučitelé (Fáze 5A, 2. část, Jakub 15. 10. 2026).
 *
 * **Všechno tady smí jen administrátor** — doporučitele, procenta i odměny
 * ostatní nevidí. `requireAdmin()` je první řádek každé akce a každá změna
 * jde do auditu ve stejné transakci (pravidlo 7). Pravidla doporučení
 * a odměn jsou v `src/lib/doporuceni.ts`.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);

const procentoSchema = z
  .string()
  .trim()
  .transform((text) => Number(text.replace(/\s/g, "").replace(",", ".")))
  .pipe(
    z
      .number({ error: "Odměna musí být číslo." })
      .min(0.01, "Odměna musí být větší než nula.")
      .max(100, "Odměna může být nejvýš 100 %."),
  );

const spolecne = {
  rewardPercent: procentoSchema,
  note: z
    .string()
    .trim()
    .max(200, "Poznámka může mít nejvýš 200 znaků.")
    .transform((text) => text || null),
};

const novySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("KLIENT"),
    clientId: ID.or(z.literal("").transform(() => null)).refine((id) => id !== null, {
      message: "Vyber klienta, který doporučuje.",
    }),
    ...spolecne,
  }),
  z.object({
    kind: z.literal("PARTNER"),
    name: z
      .string()
      .trim()
      .min(1, "Vyplň jméno partnera.")
      .max(120, "Jméno může mít nejvýš 120 znaků."),
    ...spolecne,
  }),
]);

const upravaSchema = z.object({
  id: ID,
  /** Jméno jde měnit jen u partnera — klient má jméno z karty. */
  name: z.string().trim().min(1, "Vyplň jméno partnera.").max(120).optional(),
  ...spolecne,
});

function obnov() {
  revalidatePath("/produkty/doporucitele");
  revalidatePath("/produkty/slevove-kody");
  revalidatePath("/smazane");
}

export async function ulozDoporucitele(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = formData.get("id");
  return id ? uprav(admin.id, formData) : zaloz(admin.id, formData);
}

async function zaloz(adminId: string, formData: FormData): Promise<Vysledek> {
  const vstup = novySchema.safeParse({
    kind: formData.get("kind"),
    clientId: formData.get("clientId") ?? "",
    name: formData.get("name") ?? "",
    rewardPercent: formData.get("rewardPercent") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const data = vstup.data;

  let jmeno: string;
  let clientId: string | null = null;
  if (data.kind === "KLIENT") {
    const klient = await db.client.findFirst({
      where: { id: data.clientId!, deletedAt: null },
      select: { id: true, name: true, doporucitel: { select: { name: true, deletedAt: true } } },
    });
    if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
    if (klient.doporucitel) {
      return {
        ok: false,
        chyba: klient.doporucitel.deletedAt
          ? `${klient.name} je doporučitel ve Smazaných — obnov ho tam.`
          : `${klient.name} už doporučitel je.`,
      };
    }
    jmeno = klient.name;
    clientId = klient.id;
  } else {
    jmeno = data.name;
  }

  await db.$transaction(async (tx) => {
    const zalozeny = await tx.referrer.create({
      data: {
        kind: data.kind,
        name: jmeno,
        clientId,
        rewardPercent: data.rewardPercent,
        note: data.note,
      },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "referrers",
      entityId: zalozeny.id,
      action: "doporucitel.zalozen",
      after: { druh: data.kind, name: jmeno, procento: data.rewardPercent },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: `Doporučitel je založený: ${jmeno}. Teď mu ve Slevových kódech přiřaď kód.`,
  };
}

async function uprav(adminId: string, formData: FormData): Promise<Vysledek> {
  const vstup = upravaSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name") ?? undefined,
    rewardPercent: formData.get("rewardPercent") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };
  const { id, name, ...data } = vstup.data;

  const puvodni = await db.referrer.findFirst({
    where: { id, deletedAt: null },
    select: { kind: true, name: true, rewardPercent: true, note: true },
  });
  if (!puvodni) return { ok: false, chyba: "Takový doporučitel neexistuje." };

  const nove = {
    name: puvodni.kind === "PARTNER" && name ? name : puvodni.name,
    rewardPercent: data.rewardPercent,
    note: data.note,
  };
  const rozdil = rozdilProAudit(
    { ...puvodni, rewardPercent: puvodni.rewardPercent.toNumber() },
    nove,
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.referrer.update({ where: { id }, data: nove });
    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "referrers",
      entityId: id,
      action: "doporucitel.upraven",
      ...rozdil,
    });
  });

  obnov();
  return { ok: true, zprava: `Doporučitel je uložený: ${nove.name}.` };
}

/**
 * Smaže doporučitele do koše Smazané.
 *
 * Doporučitel s platným kódem smazat nejde — kód by dál dával slevu, ale
 * nikomu by nepatřil. Kód se nejdřív smaže nebo přiřadí jinam.
 */
export async function smazDoporucitele(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Takový doporučitel neexistuje." };

  const doporucitel = await db.referrer.findFirst({
    where: { id: id.data, deletedAt: null },
    select: {
      id: true,
      name: true,
      kody: { where: { deletedAt: null }, select: { code: true } },
    },
  });
  if (!doporucitel) return { ok: false, chyba: "Takový doporučitel neexistuje." };
  if (doporucitel.kody.length > 0) {
    return {
      ok: false,
      chyba: `${doporucitel.name} má slevový kód ${doporucitel.kody.map((k) => k.code).join(", ")}. Nejdřív ho smaž nebo přiřaď jinam.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.referrer.update({ where: { id: doporucitel.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "referrers",
      entityId: doporucitel.id,
      action: "doporucitel.do-kose",
      before: { name: doporucitel.name },
    });
  });

  obnov();
  return { ok: true, zprava: `Smazáno: ${doporucitel.name}.` };
}

/** Odškrtne odměnu jako vyplacenou, nebo odškrtnutí vrátí. */
export async function oznacVyplaceni(
  odmenaIdRaw: string,
  vyplacenoRaw: boolean,
): Promise<Vysledek> {
  const admin = await requireAdmin();
  const odmenaId = ID.safeParse(odmenaIdRaw);
  // Typ v TypeScriptu platí jen v našem kódu (security.md, pravidlo 4).
  const vyplaceno = z.boolean().safeParse(vyplacenoRaw);
  if (!odmenaId.success || !vyplaceno.success) return { ok: false, chyba: "Neplatný požadavek." };

  const odmena = await db.referralReward.findUnique({
    where: { id: odmenaId.data },
    select: {
      id: true,
      amount: true,
      paidOutAt: true,
      referrer: { select: { name: true } },
      order: { select: { number: true } },
    },
  });
  if (!odmena) return { ok: false, chyba: "Taková odměna neexistuje." };
  if ((odmena.paidOutAt !== null) === vyplaceno.data) {
    return { ok: true, zprava: "Odměna už v tomhle stavu je." };
  }

  await db.$transaction(async (tx) => {
    await tx.referralReward.update({
      where: { id: odmena.id },
      data: vyplaceno.data
        ? { paidOutAt: new Date(), paidOutById: admin.id }
        : { paidOutAt: null, paidOutById: null },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "referral_rewards",
      entityId: odmena.id,
      action: vyplaceno.data ? "odmena.vyplacena" : "odmena.vyplaceni-zruseno",
      after: {
        doporucitel: odmena.referrer.name,
        objednavka: odmena.order.number,
        castka: odmena.amount.toNumber(),
      },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: vyplaceno.data
      ? `Vyplaceno: ${odmena.referrer.name}, objednávka ${odmena.order.number}.`
      : `Odměna je zase k výplatě: ${odmena.referrer.name}, objednávka ${odmena.order.number}.`,
  };
}
