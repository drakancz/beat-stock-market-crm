"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { requireAdmin } from "@/lib/session";

/**
 * Správa zdrojů klientů (Nastavení → Zdroje klientů).
 *
 * **Smí jen administrátor** (Jakub, 10. 9. 2026). `requireAdmin()` je
 * první řádek každé akce. **Zdroj se nemaže** — skryje se, nebo se sloučí
 * do jiného; klienti na něj ukazují a ze statistik nesmí zmizet.
 * Každá změna jde do auditního logu ve stejné transakci (pravidlo 7).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const nazevZdroje = z
  .string()
  .trim()
  .min(2, "Název zdroje je příliš krátký.")
  .max(60, "Název zdroje je příliš dlouhý.");

const idZdroje = z.string().trim().min(1).max(64);

function obnov() {
  revalidatePath("/nastaveni/zdroje");
  revalidatePath("/klienti");
  revalidatePath("/dashboard");
}

/** Stejný název by ve výběru u klienta nešel rozlišit. Hlídá se i proti skrytým. */
async function kolizeNazvu(nazev: string, krome?: string) {
  return db.clientSource.findFirst({
    where: {
      name: { equals: nazev, mode: "insensitive" },
      ...(krome ? { id: { not: krome } } : {}),
    },
    select: { name: true, active: true },
  });
}

export async function zalozZdroj(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const nazev = nazevZdroje.safeParse(formData.get("name") ?? "");
  if (!nazev.success) return { ok: false, chyba: nazev.error.issues[0]!.message };

  const kolize = await kolizeNazvu(nazev.data);
  if (kolize) {
    return {
      ok: false,
      chyba: kolize.active
        ? `Zdroj ${kolize.name} už v seznamu je.`
        : `Zdroj ${kolize.name} už existuje, jen je skrytý — zobraz ho znovu.`,
    };
  }

  const posledni = await db.clientSource.aggregate({ _max: { order: true } });

  await db.$transaction(async (tx) => {
    const zdroj = await tx.clientSource.create({
      data: { name: nazev.data, order: (posledni._max.order ?? 0) + 1 },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_sources",
      entityId: zdroj.id,
      action: "zdroj.zalozen",
      after: { name: nazev.data },
    });
  });

  obnov();
  return { ok: true, zprava: `Zdroj ${nazev.data} je v seznamu.` };
}

export async function prejmenujZdroj(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = idZdroje.safeParse(formData.get("id"));
  const nazev = nazevZdroje.safeParse(formData.get("name") ?? "");
  if (!id.success) return { ok: false, chyba: "Takový zdroj neexistuje." };
  if (!nazev.success) return { ok: false, chyba: nazev.error.issues[0]!.message };

  const puvodni = await db.clientSource.findUnique({
    where: { id: id.data },
    select: { name: true },
  });
  if (!puvodni) return { ok: false, chyba: "Takový zdroj neexistuje." };
  if (puvodni.name === nazev.data) return { ok: true, zprava: "Nic se nezměnilo." };

  const kolize = await kolizeNazvu(nazev.data, id.data);
  if (kolize) return { ok: false, chyba: `Zdroj ${kolize.name} už existuje. Chceš je sloučit?` };

  await db.$transaction(async (tx) => {
    await tx.clientSource.update({ where: { id: id.data }, data: { name: nazev.data } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_sources",
      entityId: id.data,
      action: "zdroj.upraven",
      before: { name: puvodni.name },
      after: { name: nazev.data },
    });
  });

  obnov();
  return { ok: true, zprava: `Zdroj se teď jmenuje ${nazev.data}.` };
}

/** Skrýt, nebo znovu nabízet. Skrytý zdroj si klienti, kteří ho mají, nechají. */
export async function prepniZdroj(idRaw: string, aktivniRaw: boolean): Promise<Vysledek> {
  const admin = await requireAdmin();

  // Z prohlížeče může přijít cokoli, i když typ říká `boolean`.
  const id = idZdroje.safeParse(idRaw);
  const stav = z.boolean().safeParse(aktivniRaw);
  if (!id.success || !stav.success) return { ok: false, chyba: "Neplatný požadavek." };
  const aktivni = stav.data;

  const zdroj = await db.clientSource.findUnique({
    where: { id: id.data },
    select: { name: true, active: true },
  });
  if (!zdroj) return { ok: false, chyba: "Takový zdroj neexistuje." };
  if (zdroj.active === aktivni) return { ok: true, zprava: "Nic se nezměnilo." };

  // Bez jediného nabízeného zdroje by nešlo založit klienta.
  if (!aktivni && (await db.clientSource.count({ where: { active: true } })) <= 1) {
    return {
      ok: false,
      chyba: "Aspoň jeden zdroj se musí nabízet, jinak nepůjde založit klienta.",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.clientSource.update({ where: { id: id.data }, data: { active: aktivni } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_sources",
      entityId: id.data,
      action: "zdroj.upraven",
      before: { name: zdroj.name, nabizi: zdroj.active },
      after: { nabizi: aktivni },
    });
  });

  obnov();
  return {
    ok: true,
    zprava: aktivni
      ? `${zdroj.name} se znovu nabízí.`
      : `${zdroj.name} se už u nových klientů nenabízí.`,
  };
}

/**
 * Sloučení: všichni klienti se zdrojem `zId` dostanou zdroj `doId`
 * a `zId` se skryje. Počítá se i s klienty v koši — po obnovení by
 * jinak ukazovali na zdroj, který v seznamu nikdo nevidí.
 */
export async function slucZdroje(zIdRaw: string, doIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const zId = idZdroje.safeParse(zIdRaw);
  const doId = idZdroje.safeParse(doIdRaw);
  if (!zId.success || !doId.success)
    return { ok: false, chyba: "Vyber, do kterého zdroje sloučit." };
  if (zId.data === doId.data) return { ok: false, chyba: "Zdroj nejde sloučit sám se sebou." };

  const [puvodni, cil] = await Promise.all([
    db.clientSource.findUnique({ where: { id: zId.data }, select: { name: true } }),
    db.clientSource.findUnique({ where: { id: doId.data }, select: { name: true } }),
  ]);
  if (!puvodni || !cil) return { ok: false, chyba: "Takový zdroj neexistuje." };

  const presunuto = await db.$transaction(async (tx) => {
    const { count } = await tx.client.updateMany({
      where: { sourceId: zId.data },
      data: { sourceId: doId.data },
    });
    await tx.clientSource.update({ where: { id: zId.data }, data: { active: false } });
    // Cíl sloučení se musí nabízet, jinak by se klienti ocitli u skrytého zdroje.
    await tx.clientSource.update({ where: { id: doId.data }, data: { active: true } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "client_sources",
      entityId: zId.data,
      action: "zdroj.sloucen",
      before: { name: puvodni.name },
      after: { doZdroje: cil.name, klientu: count },
    });

    return count;
  });

  obnov();
  return {
    ok: true,
    zprava: `${puvodni.name} je sloučený do ${cil.name} (${pocet(presunuto, "klient", "klienti", "klientů")}).`,
  };
}
