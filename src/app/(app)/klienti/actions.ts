"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin, requireViewer } from "@/lib/session";
import { CHRANENA_KARTA, jeChranenaKarta } from "@/lib/ukazka-ochrana";
import { dataKlienta, posliWebhook } from "@/lib/webhooky";
import { sjednotTelefon } from "@/lib/telefon";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  POPIS_DUVODU_NEODESLANI,
  odesliNovehoKlienta,
  posliKlientaRucne,
  propisUpravuKlienta,
} from "@/lib/smartemailing";

/**
 * Zakládání a úprava klientů.
 *
 * Pravidla, která tu platí bez výjimky:
 *
 * 1. **Rozsah se rozhoduje na serveru**, podmínkou v dotazu do databáze,
 *    ne skrytím tlačítka (security_warnings.md, pravidlo 5). Klienty vidí
 *    a mění od 22. 9. 2026 každý přihlášený — nikomu se nepřiřazují.
 * 2. **Klient nemá obchodníka** (Jakub, 22. 9. 2026). Kolonka i pravidlo
 *    „obchodník sahá jen na své" zanikly s přechodem na objednávky
 *    z Landing Page.
 * 3. **Souhlasy se evidují s datem** (pravidlo 6). Zaškrtnutí uloží
 *    okamžik, odškrtnutí ho smaže. Už udělený souhlas se datem
 *    nepřepisuje — jinak by se historie ztratila.
 * 4. **Zápis do auditního logu je součástí změny**, ve stejné transakci
 *    (pravidlo 7). Zapisuje se jen to, co je nutné k doložení změny.
 */

export type Vysledek = { ok: true; id?: string; zprava: string } | { ok: false; chyba: string };

const STAVY = z.enum([
  "NOVY",
  "KONTAKTOVAN",
  "MA_ZAJEM",
  "MA_UCET",
  "AKTIVNE_OBCHODUJE",
  "NEAKTIVNI",
]);

/**
 * Kontakt na klienta — **e-mail je povinný, telefon ne** (Jakub,
 * 15. 9. 2026). Předtím stačil jeden z nich; klienta bez e-mailu ale
 * nejde poslat do SmartEmailingu. Databáze to hlídá taky (`NOT NULL`).
 */
const emailKlienta = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Vyplň e-mail.")
  .max(254, "E-mail je příliš dlouhý.")
  .refine(
    (hodnota) => z.email().safeParse(hodnota).success,
    "Tohle nevypadá jako e-mailová adresa.",
  );

/**
 * Telefon se ukládá v jednotném tvaru `+420 601 234 567` (Jakub,
 * 26. 9. 2026) — `sjednotTelefon()` ze `src/lib/telefon.ts`.
 */
const telefonKlienta = z
  .string()
  .trim()
  .max(24, "Telefon je příliš dlouhý.")
  .refine(
    (hodnota) => hodnota === "" || sjednotTelefon(hodnota) !== null,
    "Telefon musí mít 9 číslic, případně s předvolbou (+420 601 234 567).",
  )
  .transform((hodnota) => (hodnota === "" ? null : sjednotTelefon(hodnota)));

const klientSchema = z.object({
  name: z.string().trim().min(2, "Jméno je příliš krátké.").max(120, "Jméno je příliš dlouhé."),
  email: emailKlienta,
  phone: telefonKlienta,
  // Poznámka ve formuláři byla do 23. 9. 2026. Od té doby jsou poznámky
  // samostatné zápisy v okně Poznámky na kartě (`poznamky-actions.ts`).
  // Zdroj je položka ze seznamu v Nastavení (Jakub, 10. 9. 2026). Že
  // opravdu existuje, se ověřuje dotazem níž.
  sourceId: z.string().trim().min(1, "Vyber, odkud o nás ví.").max(64, "Vyber, odkud o nás ví."),
  stage: STAVY,
  // Souhlas s marketingem se vybírá povinně, Souhlasí / Nesouhlasí (Jakub,
  // 15. 9. 2026). Nezaškrtnuté políčko nešlo odlišit od přehlédnutého.
  souhlasMarketing: z
    .enum(["ano", "ne"], { error: "Vyber, jestli klient souhlasí s marketingem." })
    .transform((volba) => volba === "ano"),
});

function precti(formData: FormData) {
  return {
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    sourceId: formData.get("sourceId") ?? "",
    stage: formData.get("stage"),
    souhlasMarketing: formData.get("souhlasMarketing"),
  };
}

/** Souhlas: zaškrtnuto uloží datum, odškrtnuto smaže. Už udělený se nepřepisuje. */
function datumSouhlasu(zaskrtnuto: boolean, puvodni: Date | null): Date | null {
  if (!zaskrtnuto) return null;
  return puvodni ?? new Date();
}

/* ---------- Založení ---------- */

export async function zalozKlienta(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const vstup = klientSchema.safeParse(precti(formData));
  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const data = vstup.data;

  // Nový klient dostane jen zdroj, který se v Nastavení nabízí.
  const zdroj = await db.clientSource.findFirst({
    where: { id: data.sourceId, active: true },
    select: { id: true, name: true },
  });
  if (!zdroj) return { ok: false, chyba: "Vyber, odkud o nás ví." };

  // Jedinečný je e-mail i mezi smazanými klienty.
  if (await db.client.findUnique({ where: { email: data.email }, select: { id: true } })) {
    return { ok: false, chyba: "Klient s tímto e-mailem už v systému je." };
  }

  const ted = new Date();

  const klient = await db.$transaction(async (tx) => {
    const novy = await tx.client.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        sourceId: zdroj.id,
        stage: data.stage,
        consentMarketingAt: data.souhlasMarketing ? ted : null,
      },
      select: { id: true, name: true, email: true, stage: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: novy.id,
      action: "klient.zalozen",
      after: {
        name: novy.name,
        email: novy.email,
        stage: novy.stage,
        souhlasMarketing: data.souhlasMarketing,
        zdroj: zdroj.name,
      },
    });

    return novy;
  });

  // Do SmartEmailingu až po odpovědi — jeho výpadek nesmí zdržet ani shodit
  // založení klienta. Souhlas a zapnuté propojení ověří `odesliNovehoKlienta()`
  // sama; tady se jen nevolá zbytečně (Jakub, 13. 9. 2026).
  if (data.souhlasMarketing) {
    after(() => odesliNovehoKlienta(klient.id, viewer.id));
  }
  // Odchozí webhooky (19. 10. 2026) — bez kontaktů.
  posliWebhook("klient.novy", () => dataKlienta(klient.id));

  revalidatePath("/klienti");
  revalidatePath("/dashboard");

  return { ok: true, id: klient.id, zprava: `${klient.name} je v seznamu klientů.` };
}

/* ---------- Úprava ---------- */

export async function upravKlienta(idRaw: string, formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };
  if (await jeChranenaKarta(id.data)) return { ok: false, chyba: CHRANENA_KARTA };

  const vstup = klientSchema.safeParse(precti(formData));
  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Zkontroluj vyplněné údaje." };
  }

  const data = vstup.data;

  // Podmínka viditelnosti je součástí dotazu — obchodník na cizího
  // klienta nedosáhne, ani když zná jeho id.
  const puvodni = await db.client.findFirst({
    where: { AND: [{ id: id.data }, viditelniKlienti(viewer)] },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      sourceId: true,
      source: { select: { name: true } },
      stage: true,
      consentMarketingAt: true,
    },
  });

  if (!puvodni) return { ok: false, chyba: "Takový klient neexistuje, nebo na něj nemáš přístup." };

  // Aktivní zdroj, nebo ten, který klient už má — i kdyby ho mezitím
  // administrátor skryl, úprava jiného políčka ho nesmí shodit.
  const zdroj = await db.clientSource.findFirst({
    where: { id: data.sourceId, OR: [{ active: true }, { id: puvodni.sourceId }] },
    select: { id: true, name: true },
  });
  if (!zdroj) return { ok: false, chyba: "Vyber, odkud o nás ví." };

  if (data.email !== puvodni.email) {
    const kolize = await db.client.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (kolize) return { ok: false, chyba: "Klient s tímto e-mailem už v systému je." };
  }

  const nove = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    sourceId: zdroj.id,
    stage: data.stage,
    consentMarketingAt: datumSouhlasu(data.souhlasMarketing, puvodni.consentMarketingAt),
    // Opravený e-mail už není ten, který SmartEmailing hlásil jako
    // nedoručitelný — klient zmizí ze seznamu Špatný e-mail.
    ...(data.email !== puvodni.email ? { smartemailingBouncedAt: null } : {}),
    // Znovu udělený souhlas — dřívější odhlášení z odběru už neplatí a
    // kolonka na kartě by jen mátla.
    ...(data.souhlasMarketing && puvodni.consentMarketingAt === null
      ? { smartemailingOptedOutAt: null }
      : {}),
  };

  // Do auditu jde jen to, co se skutečně změnilo — ne celý záznam.
  const zmeny: Record<string, { z: unknown; na: unknown }> = {};
  for (const klic of ["name", "email", "phone", "stage"] as const) {
    if (nove[klic] !== puvodni[klic]) zmeny[klic] = { z: puvodni[klic], na: nove[klic] };
  }
  // Zdroj se do auditu píše názvem, ne id — ať je z historie čitelný.
  if (zdroj.id !== puvodni.sourceId) zmeny.zdroj = { z: puvodni.source.name, na: zdroj.name };
  for (const [klic, puvodniDatum, noveDatum] of [
    ["souhlasMarketing", puvodni.consentMarketingAt, nove.consentMarketingAt],
  ] as const) {
    if ((puvodniDatum === null) !== (noveDatum === null)) {
      zmeny[klic] = { z: puvodniDatum !== null, na: noveDatum !== null };
    }
  }

  if (Object.keys(zmeny).length === 0) {
    return { ok: true, id: puvodni.id, zprava: "Nic se nezměnilo." };
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: puvodni.id }, data: nove });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "clients",
      entityId: puvodni.id,
      action: "klient.upraven",
      before: Object.fromEntries(
        Object.entries(zmeny).map(([k, v]) => [k, v.z]),
      ) as Prisma.InputJsonValue,
      after: Object.fromEntries(
        Object.entries(zmeny).map(([k, v]) => [k, v.na]),
      ) as Prisma.InputJsonValue,
    });
  });

  // SmartEmailing (Jakub, 15. 9. 2026, přepsáno proti 13. 9.): zaškrtnutý
  // i odebraný souhlas a nový e-mail se propisují. Až po odpovědi — výpadek
  // SmartEmailingu nesmí zdržet ani shodit úpravu klienta.
  const souhlasPred = puvodni.consentMarketingAt !== null;
  const souhlasPo = nove.consentMarketingAt !== null;
  if (souhlasPred !== souhlasPo || (souhlasPo && nove.email !== puvodni.email)) {
    after(() =>
      propisUpravuKlienta(
        puvodni.id,
        viewer.id,
        { email: puvodni.email, souhlas: souhlasPred },
        { email: nove.email, souhlas: souhlasPo },
      ),
    );
  }

  revalidatePath("/klienti");
  revalidatePath(`/klienti/${puvodni.id}`);
  revalidatePath("/dashboard");

  return { ok: true, id: puvodni.id, zprava: `Změny jsou uložené: ${data.name}.` };
}

/**
 * Tlačítko Poslat do SmartEmailingu na kartě klienta. **Jen administrátor**
 * (Jakub, 15. 9. 2026). Posílá aktuální údaje z karty a rozhoduje souhlas
 * v CRM — přihlásí i toho, kdo se ve SmartEmailingu dřív odhlásil.
 */
export async function posliKlientaDoSmartemailingu(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  let vysledek;
  try {
    vysledek = await posliKlientaRucne(id.data, admin.id);
  } catch {
    return { ok: false, chyba: "Odeslání se nepovedlo. Zkus to za chvíli znovu." };
  }

  revalidatePath(`/klienti/${id.data}`);
  revalidatePath("/smartemailing");
  revalidatePath("/smartemailing/chyby");

  switch (vysledek.stav) {
    case "odeslano":
      return { ok: true, zprava: "Klient odešel do SmartEmailingu." };
    case "chyba":
      return {
        ok: false,
        chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}. Chyba je zapsaná v SmartEmailing → Chyby.`,
      };
    case "vypnuto":
      return {
        ok: false,
        chyba: "Propojení se SmartEmailingem je vypnuté nebo nemá vybraný seznam.",
      };
    case "nelze":
      return { ok: false, chyba: `${POPIS_DUVODU_NEODESLANI[vysledek.duvod]} Nic neodešlo.` };
    case "vyreseno":
      return { ok: false, chyba: "Takový klient v systému není." };
  }
}

/**
 * Odložení klienta do koše.
 *
 * Smí ho jen administrátor. Klient nese souhlasy, objednávky i historii —
 * není to rutina pro obchodníka, který by ho odklikl omylem.
 *
 * Nemaže se: řádek i všechno navěšené zůstává, klient jen zmizí ze
 * seznamů a z přehledů. Vrátit ho jde ve společném koši.
 */
export async function dejKlientaDoKose(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const kdo = z.string().trim().min(1).max(64).safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný klient." };
  if (await jeChranenaKarta(kdo.data)) return { ok: false, chyba: CHRANENA_KARTA };

  const klient = await db.client.findUnique({
    where: { id: kdo.data },
    select: { id: true, name: true, email: true, deletedAt: true },
  });

  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };
  if (klient.deletedAt) return { ok: false, chyba: `${klient.name} už mezi klienty není.` };

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: klient.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "clients",
      entityId: klient.id,
      action: "klient.do-kose",
      after: { name: klient.name, email: klient.email },
    });
  });

  revalidatePath("/klienti");
  revalidatePath(`/klienti/${klient.id}`);
  revalidatePath("/smazane");
  revalidatePath("/dashboard");

  // Slovo „koš" se uživateli neukazuje (Jakub, 6. 9. 2026). Jméno za
  // dvojtečkou, aby hláška seděla u mužů i u žen (Jakub, 15. 9. 2026).
  return { ok: true, zprava: `Smazáno: ${klient.name}.` };
}
