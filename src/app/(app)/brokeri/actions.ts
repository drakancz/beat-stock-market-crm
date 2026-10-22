"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * Změny brokerů. Smí je dělat jen administrátor.
 *
 * Brokeři jsou katalog názvů (podle něj se rozpozná broker, kterého klient
 * uvede na webu) — kdo se z něj vyřadí, ovlivní práci celého týmu. Proto tu platí totéž co
 * u uživatelů: oprávnění se ověřuje na serveru, vstup se kontroluje
 * a každá změna jde do auditního logu ve stejné transakci.
 *
 * **Klíč k brokerovi sem nepatří.** Tenhle seznam je jen katalog názvů;
 * přístup k účtu si vkládá sám klient ve své části systému
 * (security_warnings.md, pravidla 1 a 2).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const AUTO_CONNECT = z.enum(["ANO", "PRAVDEPODOBNE", "ZATIM_NE"]);

/**
 * Odkaz musí být `https`, nic jiného.
 *
 * `http` by prohlížeč u zabezpečené stránky stejně zablokoval a `javascript:`
 * nebo `data:` je klasická cesta, jak do stránky propašovat cizí kód —
 * vstup od uživatele je vždy podezřelý (security_warnings.md, pravidlo 11).
 */
const odkaz = (popis: string) =>
  z
    .string()
    .trim()
    .max(300, `${popis} je příliš dlouhý.`)
    .refine(
      (hodnota) => hodnota === "" || /^https:\/\/[^\s"'<>]+$/.test(hodnota),
      `${popis} musí začínat https:// a nesmí obsahovat mezery.`,
    );

const brokerVstup = z.object({
  name: z.string().trim().min(2, "Název je příliš krátký.").max(80, "Název je příliš dlouhý."),
  autoConnect: AUTO_CONNECT,
  website: odkaz("Odkaz na web"),
  logo: odkaz("Odkaz na logo"),
  note: z.string().trim().max(500, "Poznámka je příliš dlouhá."),
});

const idBrokera = z.string().trim().min(1).max(64);

/**
 * Z názvu udělá čitelné id („Interactive Brokers" → `interactive-brokers`).
 *
 * Brokeři v databázi mají krátká čitelná id už ze začátku (`ibkr`, `xtb`),
 * ať se dají poznat i v odkazech a v auditním logu. Náhodné id by bylo
 * jednodušší, ale hůř se s ním pracuje.
 */
function naId(nazev: string): string {
  const zaklad = nazev
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return zaklad || "broker";
}

/** Najde volné id — kdyby vznikli dva brokeři s podobným názvem. */
async function volneId(nazev: string): Promise<string> {
  const zaklad = naId(nazev);

  for (let poradi = 0; poradi < 50; poradi += 1) {
    const kandidat = poradi === 0 ? zaklad : `${zaklad}-${poradi + 1}`;
    const obsazene = await db.broker.findUnique({ where: { id: kandidat }, select: { id: true } });
    if (!obsazene) return kandidat;
  }

  throw new Error("Nepodařilo se vytvořit id brokera.");
}

function prazdneNaNull(hodnota: string): string | null {
  return hodnota === "" ? null : hodnota;
}

export async function zalozBrokera(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = brokerVstup.safeParse({
    name: formData.get("name"),
    autoConnect: formData.get("autoConnect"),
    website: formData.get("website") ?? "",
    logo: formData.get("logo") ?? "",
    note: formData.get("note") ?? "",
  });

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const { name, autoConnect, website, logo, note } = vstup.data;

  // Název se hlídá i proti brokerům v koši — jinak by po obnovení byli
  // v seznamu dva stejní a nikdo by nepoznal, který je který.
  const stejnyNazev = await db.broker.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, deletedAt: true },
  });

  if (stejnyNazev) {
    return {
      ok: false,
      chyba: stejnyNazev.deletedAt
        ? "Broker s tímhle názvem je mezi smazanými. Obnovit ho jde na obrazovce Smazané."
        : "Broker s tímhle názvem už v seznamu je.",
    };
  }

  const id = await volneId(name);

  await db.$transaction(async (tx) => {
    const broker = await tx.broker.create({
      data: {
        id,
        name,
        autoConnect,
        website: prazdneNaNull(website),
        logo: prazdneNaNull(logo),
        note: prazdneNaNull(note),
      },
    });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "broker",
      entityId: broker.id,
      action: "broker.zalozen",
      after: { name, autoConnect },
    });
  });

  revalidatePath("/brokeri");
  revalidatePath("/sprava");

  return { ok: true, zprava: `Broker ${name} je v seznamu.` };
}

export async function upravBrokera(id: string, formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const kdo = idBrokera.safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný broker." };

  const vstup = brokerVstup.safeParse({
    name: formData.get("name"),
    autoConnect: formData.get("autoConnect"),
    website: formData.get("website") ?? "",
    logo: formData.get("logo") ?? "",
    note: formData.get("note") ?? "",
  });

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const puvodni = await db.broker.findUnique({ where: { id: kdo.data } });
  if (!puvodni) return { ok: false, chyba: "Broker už v seznamu není." };

  const { name, autoConnect, website, logo, note } = vstup.data;

  const stejnyNazev = await db.broker.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: { not: puvodni.id } },
    select: { id: true, deletedAt: true },
  });

  if (stejnyNazev) {
    return {
      ok: false,
      chyba: stejnyNazev.deletedAt
        ? "Broker s tímhle názvem je mezi smazanými."
        : "Broker s tímhle názvem už v seznamu je.",
    };
  }

  const novy = {
    name,
    autoConnect,
    website: prazdneNaNull(website),
    logo: prazdneNaNull(logo),
    note: prazdneNaNull(note),
  };

  // Do auditu jdou jen pole, která se opravdu změnila — jinak by se
  // v historii nedalo poznat, co se dělo.
  const zmeny = Object.entries(novy).filter(
    ([klic, hodnota]) => puvodni[klic as keyof typeof novy] !== hodnota,
  );

  if (zmeny.length === 0) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.broker.update({ where: { id: puvodni.id }, data: novy });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "broker",
      entityId: puvodni.id,
      action: "broker.upraven",
      before: Object.fromEntries(zmeny.map(([klic]) => [klic, puvodni[klic as keyof typeof novy]])),
      after: Object.fromEntries(zmeny),
    });
  });

  revalidatePath("/brokeri");
  revalidatePath(`/brokeri/${puvodni.id}`);
  revalidatePath("/sprava");

  return { ok: true, zprava: `Změny u brokera ${name} jsou uložené.` };
}

/** Obnoví všechny obrazovky, kde se broker může objevit. */
function obnovStranky(id: string) {
  revalidatePath("/brokeri");
  revalidatePath("/brokeri/smazani");
  revalidatePath(`/brokeri/${id}`);
  revalidatePath("/sprava");
}

/**
 * Odložení brokera do koše.
 *
 * **Nemaže se, jen se schová.** Řádek zůstává v databázi, historie dává
 * smysl a dá se vrátit zpátky.
 *
 * Kdo brokera odložil, je v auditním logu.
 */
export async function dejBrokeraDoKose(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const kdo = idBrokera.safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný broker." };

  const broker = await db.broker.findUnique({
    where: { id: kdo.data },
    select: { id: true, name: true, deletedAt: true },
  });

  if (!broker) return { ok: false, chyba: "Takový broker v systému není." };
  if (broker.deletedAt) return { ok: false, chyba: `Broker ${broker.name} už je smazaný.` };

  await db.$transaction(async (tx) => {
    await tx.broker.update({ where: { id: broker.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "broker",
      entityId: broker.id,
      action: "broker.do-kose",
      after: { name: broker.name },
    });
  });

  obnovStranky(broker.id);

  // Slovo „koš" ani nabídka obnovy se uživateli neukazuje (Jakub, 6. 9. 2026).
  return { ok: true, zprava: `Broker ${broker.name} je smazaný.` };
}

/** Vrácení brokera z koše zpátky do seznamu. */
export async function obnovBrokera(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const kdo = idBrokera.safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný broker." };

  const broker = await db.broker.findUnique({
    where: { id: kdo.data },
    select: { id: true, name: true, deletedAt: true },
  });

  if (!broker) return { ok: false, chyba: "Takový broker v systému není." };
  if (!broker.deletedAt) return { ok: false, chyba: `Broker ${broker.name} smazaný není.` };

  await db.$transaction(async (tx) => {
    await tx.broker.update({ where: { id: broker.id }, data: { deletedAt: null } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "broker",
      entityId: broker.id,
      action: "broker.obnoven",
      after: { name: broker.name },
    });
  });

  obnovStranky(broker.id);

  return { ok: true, zprava: `${broker.name} je zpátky v seznamu.` };
}
