"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { bezDph } from "@/lib/dph";
import { prepocitejPlatnost, zrusPlatnostProduktu } from "@/lib/platnost";
import { requireAdmin, requireViewer } from "@/lib/session";
import { maPlatnost } from "@/lib/types";

import { MENA_CENIKU } from "./nabidka";

/**
 * Zakládání a úprava produktů v ceníku.
 *
 * **Zakládat i upravovat smí manažer a administrátor** (Jakub, 8. 9.
 * a 10. 9. 2026) — ceník je společný pro celou firmu, ne poznámkový blok
 * jednoho obchodníka. Obchodníkovi se tlačítka neukážou, ale rozhoduje
 * o tom tahle kontrola na serveru, ne skrytí v rozhraní
 * (security_warnings.md, pravidlo 5).
 *
 * **Cena se ukládá bez DPH** a k ní se vybírá jedna ze tří sazeb
 * (Jakub, 10. 9. 2026); cena s DPH se dopočítává (`src/lib/dph.ts`).
 * Zadat jde s DPH i bez (přepínač, výchozí s DPH — Jakub, 27. 9. 2026).
 *
 * **Cena je nepovinná** — produkt, u kterého se teprve stanovuje, se dá
 * založit i bez ní a uloží se nula. Do auditního logu jde záznam ve
 * stejné transakci jako samotný zápis (pravidlo 7).
 */

export type Vysledek = { ok: true; id?: string; zprava: string } | { ok: false; chyba: string };

const DRUHY = z.enum(["KURZ", "CLENSTVI", "KONZULTACE"]);

/**
 * Cena z formuláře.
 *
 * Prázdné políčko znamená „zatím nevíme" a uloží se nula. Člověk píše
 * česky, tedy s čárkou a mezerami mezi tisíci; bereme obojí a výsledek
 * se ověří (security_warnings.md, pravidlo 11).
 */
const cena = z
  .string()
  .trim()
  .transform((text) => (text === "" ? 0 : Number(text.replace(/\s/g, "").replace(",", "."))))
  .pipe(
    z
      .number({ error: "Cena musí být číslo." })
      .min(0, "Cena nemůže být záporná.")
      .max(100_000_000, "Cena je nesmyslně vysoká."),
  );

/**
 * Odkaz na stránku produktu (Jakub, 24. 9. 2026). Jen `https` — `http`
 * by prohlížeč zablokoval a `javascript:` nebo `data:` je cesta, jak do
 * stránky dostat cizí kód (security_warnings.md, pravidlo 11). Stejné
 * pravidlo jako u odkazů brokerů. Prázdné = produkt odkaz nemá.
 */
const odkaz = z
  .string()
  .trim()
  .max(300, "Odkaz na stránku produktu je příliš dlouhý.")
  .refine(
    (hodnota) => hodnota === "" || /^https:\/\/[^\s"'<>]+$/.test(hodnota),
    "Odkaz na stránku produktu musí začínat https:// a nesmí obsahovat mezery.",
  )
  .transform((hodnota) => (hodnota === "" ? null : hodnota));

/**
 * Délka platnosti v měsících (Jakub, 24. 9. 2026). Prázdné = neomezeno,
 * produkt nekončí. Strop deset let — delší číslo je překlep.
 */
const platnost = z
  .string()
  .trim()
  .transform((text) => (text === "" ? null : Number(text)))
  .pipe(
    z
      .number({ error: "Platnost musí být celý počet měsíců." })
      .int("Platnost musí být celý počet měsíců.")
      .min(1, "Platnost musí být aspoň 1 měsíc. Produkt, který nekončí, má Neomezeno.")
      .max(120, "Platnost může být nejvýš 120 měsíců.")
      .nullable(),
  );

const produktSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Název produktu je příliš krátký.")
      .max(120, "Název produktu je příliš dlouhý."),
    kind: DRUHY,
    zadanaCena: cena,
    // Zadaná cena je s DPH, nebo bez (Jakub, 27. 9. 2026). Ukládá se vždy bez.
    rezimCeny: z.enum(["sDph", "bezDph"], { error: "Vyber, jestli je cena s DPH, nebo bez." }),
    vatRateId: z.string({ error: "Vyber sazbu DPH." }).trim().min(1, "Vyber sazbu DPH.").max(64),
    active: z.boolean(),
    url: odkaz,
    validityMonths: platnost,
  })
  // Kurz má klient po zakoupení napořád (Jakub, 27. 9. 2026), konzultace
  // je jednorázová (28. 9. 2026). Formulář délku u nich vůbec nenabízí;
  // tohle chytí požadavek poslaný mimo něj.
  .refine((produkt) => maPlatnost(produkt.kind) || produkt.validityMonths === null, {
    message: "U kurzu a konzultace se délka platnosti nezadává.",
    path: ["validityMonths"],
  });

/**
 * Cena bez DPH, která se uloží. Přepočet dělá server se sazbou z databáze,
 * ne prohlížeč — ten posílá jen, co člověk napsal, a jestli je to s DPH.
 */
function cenaBezDph(
  data: { zadanaCena: number; rezimCeny: "sDph" | "bezDph" },
  sazbaProcent: number,
): number {
  return data.rezimCeny === "sDph" ? bezDph(data.zadanaCena, sazbaProcent) : data.zadanaCena;
}

/** Hodnoty z formuláře produktu — stejné pro založení i úpravu. */
function zFormulare(formData: FormData) {
  return produktSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    zadanaCena: formData.get("netPrice") ?? "",
    rezimCeny: formData.get("rezimCeny"),
    vatRateId: formData.get("vatRateId"),
    active: formData.get("active") !== "neaktivni",
    url: formData.get("url") ?? "",
    validityMonths: formData.get("validityMonths") ?? "",
  });
}

export async function zalozProdukt(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  // Ceník mění jen administrátor (od 22. 9. 2026, kdy se role sloučily
  // na dvě — dřív i manažer). Jsou to ceny, stejně jako stavy objednávek.
  // Kontrola je tady, ne jen ve výpisu: formulář jde odeslat i mimo
  // obrazovku, na které tlačítko není.
  if (viewer.role !== "ADMINISTRATOR") {
    return { ok: false, chyba: "Zakládat produkty smí administrátor." };
  }

  const vstup = zFormulare(formData);

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const data = vstup.data;

  // Sazba musí být jedna z těch, které v systému jsou — ne cokoli, co
  // přišlo z formuláře.
  const sazba = await db.vatRate.findUnique({
    where: { id: data.vatRateId },
    select: { id: true, name: true, rate: true },
  });

  if (!sazba) return { ok: false, chyba: "Vybraná sazba DPH neexistuje." };

  const netPrice = cenaBezDph(data, sazba.rate.toNumber());

  // Název se porovnává bez ohledu na velikost písmen — jinak by v ceníku
  // skončilo „VIP členství" i „VIP Členství" vedle sebe. Smazané produkty
  // se nepočítají — název po smazaném jde použít znovu; shodu pak hlídá
  // obnovení ve Smazaných.
  const kolize = await db.product.findFirst({
    where: { deletedAt: null, name: { equals: data.name, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (kolize) return { ok: false, chyba: `Produkt ${kolize.name} už v ceníku je.` };

  const produkt = await db.$transaction(async (tx) => {
    const novy = await tx.product.create({
      data: {
        name: data.name,
        kind: data.kind,
        netPrice,
        vatRateId: sazba.id,
        currency: MENA_CENIKU,
        active: data.active,
        url: data.url,
        validityMonths: data.validityMonths,
      },
      select: { id: true, name: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "products",
      entityId: novy.id,
      action: "produkt.zalozen",
      after: {
        name: novy.name,
        druh: data.kind,
        cenaBezDph: netPrice,
        sazbaDph: { name: sazba.name, rate: sazba.rate.toNumber() },
        mena: MENA_CENIKU,
        vProdeji: data.active,
        odkaz: data.url,
        platnostMesicu: data.validityMonths,
      },
    });

    return novy;
  });

  revalidatePath("/produkty");

  return { ok: true, id: produkt.id, zprava: `${produkt.name} je v ceníku.` };
}

/**
 * Úprava produktu.
 *
 * Změna ceny nebo sazby se projeví i u obchodních případů, ve kterých
 * produkt je — ceny se u případů nekopírují, berou se z ceníku (Jakub,
 * 8. 9. 2026). Do auditu jde jen to, co se opravdu změnilo.
 */
export async function upravProdukt(id: string, formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  if (viewer.role !== "ADMINISTRATOR") {
    return { ok: false, chyba: "Upravovat produkty smí administrátor." };
  }

  const idProduktu = z.string().trim().min(1).max(64).safeParse(id);
  if (!idProduktu.success) return { ok: false, chyba: "Takový produkt neexistuje." };

  const puvodni = await db.product.findFirst({
    where: { id: idProduktu.data, deletedAt: null },
    select: {
      id: true,
      name: true,
      kind: true,
      netPrice: true,
      active: true,
      url: true,
      validityMonths: true,
      vatRate: { select: { name: true } },
    },
  });
  if (!puvodni) return { ok: false, chyba: "Takový produkt neexistuje." };

  const vstup = zFormulare(formData);

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const data = vstup.data;

  const sazba = await db.vatRate.findUnique({
    where: { id: data.vatRateId },
    select: { id: true, name: true, rate: true },
  });
  if (!sazba) return { ok: false, chyba: "Vybraná sazba DPH neexistuje." };

  const netPrice = cenaBezDph(data, sazba.rate.toNumber());

  const kolize = await db.product.findFirst({
    where: {
      id: { not: puvodni.id },
      deletedAt: null,
      name: { equals: data.name, mode: "insensitive" },
    },
    select: { name: true },
  });
  if (kolize) return { ok: false, chyba: `Produkt ${kolize.name} už v ceníku je.` };

  const zmeny: Record<string, { z: unknown; na: unknown }> = {};
  const porovnej = (klic: string, drive: unknown, nyni: unknown) => {
    if (drive !== nyni) zmeny[klic] = { z: drive, na: nyni };
  };

  porovnej("nazev", puvodni.name, data.name);
  porovnej("druh", puvodni.kind, data.kind);
  porovnej("cenaBezDph", puvodni.netPrice.toNumber(), netPrice);
  porovnej("sazbaDph", puvodni.vatRate.name, sazba.name);
  porovnej("vProdeji", puvodni.active, data.active);
  porovnej("odkaz", puvodni.url, data.url);
  porovnej("platnostMesicu", puvodni.validityMonths, data.validityMonths);

  if (Object.keys(zmeny).length === 0) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(
    async (tx) => {
      await tx.product.update({
        where: { id: puvodni.id },
        data: {
          name: data.name,
          kind: data.kind,
          netPrice,
          vatRateId: sazba.id,
          active: data.active,
          url: data.url,
          validityMonths: data.validityMonths,
        },
      });

      /*
       * Nová délka se projeví jen u zaplacených objednávek, které délku
       * opsanou nemají — zaplacených dřív, než ji produkt měl. Co se platilo
       * s délkou, tu si nechá (Jakub, 24. 9. 2026).
       */
      if (!maPlatnost(data.kind) && (maPlatnost(puvodni.kind) || puvodni.validityMonths !== null)) {
        // Z produktu se stal kurz nebo konzultace — platnost nemá.
        await zrusPlatnostProduktu(tx, puvodni.id);
      } else if (puvodni.validityMonths !== data.validityMonths) {
        const klienti = await tx.order.findMany({
          where: {
            status: "ZAPLACENO",
            deletedAt: null,
            items: { some: { productId: puvodni.id, validityMonths: null } },
          },
          distinct: ["clientId"],
          select: { clientId: true },
        });
        for (const { clientId } of klienti) await prepocitejPlatnost(tx, clientId);
      }

      await zapisDoAuditu(tx, {
        userId: viewer.id,
        entity: "products",
        entityId: puvodni.id,
        action: "produkt.upraven",
        // Jméno je v `before` vždycky, ať jde v Aktivitě poznat, o který
        // produkt šlo, i když se měnila jen cena.
        before: {
          name: puvodni.name,
          ...Object.fromEntries(Object.entries(zmeny).map(([klic, zmena]) => [klic, zmena.z])),
        } as Prisma.InputJsonValue,
        after: Object.fromEntries(
          Object.entries(zmeny).map(([klic, zmena]) => [klic, zmena.na]),
        ) as Prisma.InputJsonValue,
      });
      // Delší lhůta: změna délky přepočítá platnost všem, kdo produkt zaplatili.
    },
    { timeout: 30_000 },
  );

  revalidatePath("/produkty");
  if (puvodni.validityMonths !== data.validityMonths || puvodni.kind !== data.kind) {
    revalidatePath("/klienti", "layout");
  }

  return { ok: true, id: puvodni.id, zprava: `${data.name} je upravený.` };
}

/**
 * Smazání produktu z ceníku (Jakub, 27. 9. 2026).
 *
 * **Jen administrátor**, a smí i produkt, který se už prodal. Produkt se
 * nemaže z databáze, dostane `deletedAt`: zmizí z ceníku, z nabídky
 * u hovoru i z příjmu objednávek z Landing Page, ale objednávky, platnost
 * členství a tržby ho dál ukazují — jinak by z historie zmizelo, co si
 * klient koupil. Vrátit ho jde ze Smazaných, nadobro smazat jen produkt,
 * na který nic neodkazuje.
 */
export async function smazProdukt(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const idProduktu = z.string().trim().min(1).max(64).safeParse(id);
  if (!idProduktu.success) return { ok: false, chyba: "Takový produkt neexistuje." };

  const produkt = await db.product.findFirst({
    where: { id: idProduktu.data, deletedAt: null },
    select: { id: true, name: true, _count: { select: { orders: true } } },
  });
  if (!produkt) return { ok: false, chyba: "Takový produkt neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.product.update({ where: { id: produkt.id }, data: { deletedAt: new Date() } });
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "products",
      entityId: produkt.id,
      action: "produkt.do-kose",
      before: { name: produkt.name, polozekObjednavek: produkt._count.orders },
    });
  });

  revalidatePath("/produkty");
  revalidatePath("/smazane");

  return { ok: true, zprava: `Smazáno z ceníku: ${produkt.name}.` };
}
