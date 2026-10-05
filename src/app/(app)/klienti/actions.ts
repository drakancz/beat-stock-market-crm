"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { prectiOkamzik } from "@/lib/obdobi";
import { viditelniKlienti } from "@/lib/queries";
import { requireAdmin, requireViewer } from "@/lib/session";
import { sjednotTelefon } from "@/lib/telefon";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  POPIS_DUVODU_NEODESLANI,
  odesliNovehoKlienta,
  posliKlientaRucne,
  propisUpravuKlienta,
} from "@/lib/smartemailing";

import { BEZ_BROKERA } from "./vyber-brokera";
import { BEZ_PRODUKTU } from "./vyber-produktu";
import type { Viewer } from "@/lib/session";

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
 * Měny, ve kterých se portfolio vede.
 *
 * Uzavřený seznam schválně: sloupec v databázi má tři znaky a cokoli
 * jiného by se tam stejně nevešlo (security_warnings.md, pravidlo 11).
 */
const MENA = z.enum(["CZK", "EUR", "USD"]);

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
  souhlasNahravani: z.boolean(),
});

function precti(formData: FormData) {
  return {
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    sourceId: formData.get("sourceId") ?? "",
    stage: formData.get("stage"),
    souhlasMarketing: formData.get("souhlasMarketing"),
    souhlasNahravani: formData.get("souhlasNahravani") === "on",
  };
}

/** Souhlas: zaškrtnuto uloží datum, odškrtnuto smaže. Už udělený se nepřepisuje. */
function datumSouhlasu(zaskrtnuto: boolean, puvodni: Date | null): Date | null {
  if (!zaskrtnuto) return null;
  return puvodni ?? new Date();
}

/* ---------- Založení ---------- */

/**
 * Přečte volitelného brokera ze zakládacího formuláře.
 *
 * Vrací `brokerId: null`, když se žádný nevybral. Měna se čte i tak —
 * bez brokera se prostě nepoužije.
 */
function precteniBrokera(
  formData: FormData,
):
  | { ok: true; brokerId: string | null; currency: "CZK" | "EUR" | "USD" }
  | { ok: false; chyba: string } {
  const mena = MENA.safeParse(formData.get("currency") ?? "CZK");
  if (!mena.success) return { ok: false, chyba: "Vyber měnu účtu." };

  const zadany = z
    .string()
    .trim()
    .max(64)
    .safeParse(formData.get("brokerId") ?? BEZ_BROKERA);
  if (!zadany.success) return { ok: false, chyba: "Neplatný broker." };

  if (!zadany.data || zadany.data === BEZ_BROKERA) {
    return { ok: true, brokerId: null, currency: mena.data };
  }

  return { ok: true, brokerId: zadany.data, currency: mena.data };
}

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

  // Broker je při zakládání nepovinný — ne každý nový klient už někde
  // účet má. Když se vybere, vznikne rovnou portfolio a klient se objeví
  // v seznamu u brokera.
  const vybranyBroker = precteniBrokera(formData);
  if (!vybranyBroker.ok) return { ok: false, chyba: vybranyBroker.chyba };

  const broker = vybranyBroker.brokerId
    ? await db.broker.findFirst({
        where: { id: vybranyBroker.brokerId, deletedAt: null },
        select: { id: true, name: true },
      })
    : null;

  if (vybranyBroker.brokerId && !broker) {
    return { ok: false, chyba: "Vybraný broker neexistuje." };
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
        consentRecordingAt: data.souhlasNahravani ? ted : null,
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
        souhlasNahravani: data.souhlasNahravani,
        zdroj: zdroj.name,
        broker: broker?.name ?? null,
      },
    });

    // Portfolio vzniká ve stejné transakci jako klient: buď se založí
    // obojí, nebo nic. Částky zůstávají nulové a doplní se v kroku 1C.
    if (broker) {
      const portfolio = await tx.portfolio.create({
        data: {
          clientId: novy.id,
          brokerId: broker.id,
          source: "RUCNE",
          currency: vybranyBroker.currency,
          invested: 0,
          value: 0,
        },
        select: { id: true },
      });

      await zapisDoAuditu(tx, {
        userId: viewer.id,
        entity: "portfolios",
        entityId: portfolio.id,
        action: "portfolio.zalozeno",
        after: { klient: novy.name, broker: broker.name, mena: vybranyBroker.currency },
      });
    }

    return novy;
  });

  // Do SmartEmailingu až po odpovědi — jeho výpadek nesmí zdržet ani shodit
  // založení klienta. Souhlas a zapnuté propojení ověří `odesliNovehoKlienta()`
  // sama; tady se jen nevolá zbytečně (Jakub, 13. 9. 2026).
  if (data.souhlasMarketing) {
    after(() => odesliNovehoKlienta(klient.id, viewer.id));
  }

  revalidatePath("/klienti");
  revalidatePath("/dashboard");

  if (broker) {
    revalidatePath("/portfolia");
    revalidatePath("/brokeri");
    revalidatePath(`/brokeri/${broker.id}`);

    return {
      ok: true,
      id: klient.id,
      zprava: `${klient.name} je v seznamu klientů a má portfolio u brokera ${broker.name}.`,
    };
  }

  return { ok: true, id: klient.id, zprava: `${klient.name} je v seznamu klientů.` };
}

/* ---------- Úprava ---------- */

export async function upravKlienta(idRaw: string, formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

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
      consentRecordingAt: true,
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
    consentRecordingAt: datumSouhlasu(data.souhlasNahravani, puvodni.consentRecordingAt),
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
    ["souhlasNahravani", puvodni.consentRecordingAt, nove.consentRecordingAt],
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
 * Smí ho jen administrátor. Klient nese souhlasy, hovory i historii —
 * není to rutina pro obchodníka, který by ho odklikl omylem.
 *
 * Nemaže se: řádek i všechno navěšené zůstává, klient jen zmizí ze
 * seznamů a z přehledů. Vrátit ho jde ve společném koši.
 */
export async function dejKlientaDoKose(id: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const kdo = z.string().trim().min(1).max(64).safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný klient." };

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

/*
 * Přiřazení a odebrání brokera bylo do 23. 9. 2026 v záložce Portfolia
 * na kartě klienta, která zmizela. Od 25. 9. 2026 je v oddílu Brokeři
 * ve formuláři Upravit (Jakub) — akce jsou stejné jako dřív.
 */

/* ---------- Propojení klienta s brokerem ---------- */

const noveProjeni = z.object({
  brokerId: z.string().trim().min(1).max(64),
  currency: MENA,
});

/**
 * Přiřazení klienta k brokerovi.
 *
 * Vzniká tím portfolio — vazba klient ↔ broker. Částky zůstávají nulové;
 * doplní se v kroku 1C, až se bude řešit načítání skutečných dat. Klient
 * se hned objeví na detailu brokera.
 *
 * **Smí to každý přihlášený** (Jakub, 7. 9. 2026, potvrzeno 25. 9. 2026 —
 * od 22. 9. vidí všechny klienty každý). Rozsah se přesto ověřuje
 * v dotazu, ne skrytím tlačítka — proto `viditelniKlienti(viewer)`.
 *
 * Klíč k brokerovi se sem nikdy nezadává; ten si vkládá výhradně sám
 * klient ve své části systému (pravidla 1 a 2).
 */
export async function pridejBrokera(klientIdRaw: string, formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const kdo = z.string().trim().min(1).max(64).safeParse(klientIdRaw);
  if (!kdo.success) return { ok: false, chyba: "Neplatný klient." };

  const vstup = noveProjeni.safeParse({
    brokerId: formData.get("brokerId"),
    currency: formData.get("currency"),
  });

  if (!vstup.success) {
    return { ok: false, chyba: vstup.error.issues[0]?.message ?? "Vyber brokera a měnu." };
  }

  const { brokerId, currency } = vstup.data;

  const klient = await db.client.findFirst({
    where: { AND: [{ id: kdo.data }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });

  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  // Smazaný broker se nenabízí a nepřiřadí — jinak by klient visel
  // u někoho, kdo v seznamu není.
  const broker = await db.broker.findFirst({
    where: { id: brokerId, deletedAt: null },
    select: { id: true, name: true },
  });

  if (!broker) return { ok: false, chyba: "Takový broker neexistuje." };

  // Dvojice klient + broker smí být v databázi jen jednou. Když už tam
  // je, ale leží ve smazaných, přiřazení se místo zakládání obnoví —
  // jinak by to skončilo nesrozumitelnou chybou z databáze.
  const stavajici = await db.portfolio.findUnique({
    where: { clientId_brokerId: { clientId: klient.id, brokerId: broker.id } },
    select: { id: true, deletedAt: true },
  });

  if (stavajici && !stavajici.deletedAt) {
    return { ok: false, chyba: `${klient.name} už u ${broker.name} portfolio má.` };
  }

  await db.$transaction(async (tx) => {
    const portfolio = stavajici
      ? await tx.portfolio.update({
          where: { id: stavajici.id },
          data: { deletedAt: null, currency },
          select: { id: true },
        })
      : await tx.portfolio.create({
          data: {
            clientId: klient.id,
            brokerId: broker.id,
            source: "RUCNE",
            currency,
            invested: 0,
            value: 0,
          },
          select: { id: true },
        });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "portfolios",
      entityId: portfolio.id,
      action: stavajici ? "portfolio.obnoveno" : "portfolio.zalozeno",
      after: { klient: klient.name, broker: broker.name, mena: currency },
    });
  });

  revalidatePath(`/klienti/${klient.id}`);
  revalidatePath("/klienti");
  revalidatePath("/portfolia");
  revalidatePath(`/brokeri/${broker.id}`);
  revalidatePath("/brokeri");

  return { ok: true, zprava: `${klient.name} má teď portfolio u brokera ${broker.name}.` };
}

/**
 * Odebrání brokera klientovi.
 *
 * Stejně jako u všeho ostatního se nemaže — portfolio zmizí z karty
 * klienta i ze seznamu u brokera, ale administrátor ho umí vrátit ze
 * Smazaných. Bez tohohle by omylem přiřazený broker zůstal navždy:
 * dvojice klient + broker smí v databázi existovat jen jednou.
 */
export async function odeberBrokera(portfolioIdRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const kdo = z.string().trim().min(1).max(64).safeParse(portfolioIdRaw);
  if (!kdo.success) return { ok: false, chyba: "Neplatné portfolio." };

  // Rozsah role se ověřuje přes klienta, ke kterému portfolio patří.
  const portfolio = await db.portfolio.findFirst({
    where: { id: kdo.data, deletedAt: null, client: viditelniKlienti(viewer) },
    select: {
      id: true,
      clientId: true,
      client: { select: { name: true } },
      broker: { select: { id: true, name: true } },
    },
  });

  if (!portfolio) return { ok: false, chyba: "Takové portfolio neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.portfolio.update({ where: { id: portfolio.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "portfolios",
      entityId: portfolio.id,
      action: "portfolio.do-kose",
      before: { klient: portfolio.client.name, broker: portfolio.broker.name },
    });
  });

  revalidatePath(`/klienti/${portfolio.clientId}`);
  revalidatePath("/klienti");
  revalidatePath("/portfolia");
  revalidatePath(`/brokeri/${portfolio.broker.id}`);
  revalidatePath("/brokeri");

  return {
    ok: true,
    zprava: `Odebráno: ${portfolio.broker.name} u klienta ${portfolio.client.name}.`,
  };
}

/* ---------- Hovory ---------- */

/**
 * Zápis hovoru ke klientovi.
 *
 * **Zapsat hovor smí každý, kdo klienta vidí** (Jakub, 9. 9. 2026):
 * obchodník u svých klientů, manažer a administrátor u všech. Rozsah se
 * ověřuje dotazem do databáze, ne skrytím tlačítka.
 *
 * **Upravit nebo smazat smí jen ten, kdo hovor zapsal, a administrátor.**
 * Hovor je záznam o tom, co se stalo — kolega ho nemá přepisovat.
 *
 * Do auditního logu jde, co se změnilo, ale **ne text poznámky**. Poznámka
 * bývá o tom, co klient řekl; takový obsah do logu nepatří
 * (security_warnings.md, pravidlo 8). Že se změnila, z logu poznat je.
 */
const VYSLEDKY = z.enum(["DOVOLANO", "NEDOVOLANO", "SCHUZKA", "ODMITNUTO"]);

/** Nejdelší hovor, který dává smysl zapsat. Delší je překlep. */
const MAX_MINUT = 600;

const hovorSchema = z.object({
  at: z.string().trim().min(1, "Vyplň, kdy hovor proběhl."),
  durationMin: z.coerce
    .number()
    .int("Délka musí být celé číslo minut.")
    .min(0, "Délka nemůže být záporná.")
    .max(MAX_MINUT, `Hovor delší než ${MAX_MINUT} minut je nejspíš překlep.`),
  outcome: VYSLEDKY,
  note: z.string().trim().max(5000, "Poznámka je příliš dlouhá."),
  interestProductId: z.string().trim().max(64).optional(),
});

function prectiHovor(formData: FormData) {
  return hovorSchema.safeParse({
    at: formData.get("at") ?? "",
    durationMin: formData.get("durationMin") ?? "",
    outcome: formData.get("outcome") ?? "",
    note: formData.get("note") ?? "",
    interestProductId: formData.get("interestProductId") ?? "",
  });
}

/**
 * Okamžik hovoru.
 *
 * Bere se jako pražský čas a **nesmí ležet v budoucnosti** — hovor je
 * záznam o tom, co už proběhlo. Pár minut se odpouští kvůli rozejitým
 * hodinám na strojích.
 */
function prectiKdy(hodnota: string): { ok: true; at: Date } | { ok: false; chyba: string } {
  const at = prectiOkamzik(hodnota);
  if (!at) return { ok: false, chyba: "Datum a čas hovoru nedávají smysl." };

  if (at.getTime() > Date.now() + 5 * 60_000) {
    return { ok: false, chyba: "Hovor nemůže proběhnout v budoucnosti." };
  }

  return { ok: true, at };
}

/** Produkt, o který klient projevil zájem. Neznámý se tiše zahodí. */
async function overProdukt(id: string | undefined): Promise<string | null> {
  if (!id || id === BEZ_PRODUKTU) return null;

  const produkt = await db.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  return produkt?.id ?? null;
}

export async function zapisHovor(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const klientId = z.string().trim().min(1).max(64).safeParse(formData.get("clientId"));
  if (!klientId.success) return { ok: false, chyba: "Neplatný klient." };

  // Rozsah role je v dotazu: na cizího klienta se přes adresu nedostane.
  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId.data }, viditelniKlienti(viewer)] },
    select: { id: true, name: true, lastContactAt: true },
  });
  if (!klient) return { ok: false, chyba: "Takový klient neexistuje." };

  const data = prectiHovor(formData);
  if (!data.success) return { ok: false, chyba: data.error.issues[0].message };

  const kdy = prectiKdy(data.data.at);
  if (!kdy.ok) return { ok: false, chyba: kdy.chyba };

  const interestProductId = await overProdukt(data.data.interestProductId);

  const hovor = await db.$transaction(async (tx) => {
    const zapsany = await tx.call.create({
      data: {
        clientId: klient.id,
        userId: viewer.id,
        at: kdy.at,
        durationMin: data.data.durationMin,
        outcome: data.data.outcome,
        note: data.data.note,
        interestProductId,
      },
      select: { id: true },
    });

    // Poslední kontakt se posouvá jen dopředu — dodatečně zapsaný starší
    // hovor nemá přepsat novější kontakt.
    if (!klient.lastContactAt || kdy.at > klient.lastContactAt) {
      await tx.client.update({ where: { id: klient.id }, data: { lastContactAt: kdy.at } });
    }

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "calls",
      entityId: zapsany.id,
      action: "hovor.zapsan",
      after: {
        clientId: klient.id,
        at: kdy.at.toISOString(),
        durationMin: data.data.durationMin,
        outcome: data.data.outcome,
        maPoznamku: data.data.note.length > 0,
      },
    });

    return zapsany;
  });

  revalidatePath(`/klienti/${klient.id}`);
  revalidatePath("/klienti");
  revalidatePath("/dashboard");

  return { ok: true, id: hovor.id, zprava: `Hovor s klientem ${klient.name} je zapsaný.` };
}

/**
 * Hovor, na který smí přihlášený sáhnout.
 *
 * Dvě podmínky najednou: klient musí být v rozsahu jeho role **a** hovor
 * musí být jeho vlastní, ledaže je administrátor.
 *
 * Hovor ze Smazaných se nevrací: upravit ani smazat podruhé nejde,
 * vrátit ho umí jen administrátor přes obrazovku Smazané.
 */
async function hovorKUprave(viewer: Viewer, id: string) {
  const hovor = await db.call.findFirst({
    where: { AND: [{ id, deletedAt: null }, { client: viditelniKlienti(viewer) }] },
    select: {
      id: true,
      userId: true,
      at: true,
      durationMin: true,
      outcome: true,
      note: true,
      interestProductId: true,
      client: { select: { id: true, name: true } },
    },
  });

  if (!hovor) return null;
  if (viewer.role !== "ADMINISTRATOR" && hovor.userId !== viewer.id) return null;
  return hovor;
}

export async function upravHovor(formData: FormData): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(formData.get("id"));
  if (!id.success) return { ok: false, chyba: "Neplatný hovor." };

  const puvodni = await hovorKUprave(viewer, id.data);
  // Kdo na hovor nemá nárok, se nedozví ani to, jestli vůbec existuje.
  if (!puvodni) return { ok: false, chyba: "Takový hovor neexistuje." };

  const data = prectiHovor(formData);
  if (!data.success) return { ok: false, chyba: data.error.issues[0].message };

  const kdy = prectiKdy(data.data.at);
  if (!kdy.ok) return { ok: false, chyba: kdy.chyba };

  const interestProductId = await overProdukt(data.data.interestProductId);

  const zmenilo =
    puvodni.at.getTime() !== kdy.at.getTime() ||
    puvodni.durationMin !== data.data.durationMin ||
    puvodni.outcome !== data.data.outcome ||
    puvodni.note !== data.data.note ||
    puvodni.interestProductId !== interestProductId;

  if (!zmenilo) return { ok: true, id: puvodni.id, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.call.update({
      where: { id: puvodni.id },
      data: {
        at: kdy.at,
        durationMin: data.data.durationMin,
        outcome: data.data.outcome,
        note: data.data.note,
        interestProductId,
      },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "calls",
      entityId: puvodni.id,
      action: "hovor.upraven",
      before: {
        at: puvodni.at.toISOString(),
        durationMin: puvodni.durationMin,
        outcome: puvodni.outcome,
        maPoznamku: puvodni.note.length > 0,
      },
      after: {
        at: kdy.at.toISOString(),
        durationMin: data.data.durationMin,
        outcome: data.data.outcome,
        maPoznamku: data.data.note.length > 0,
      },
    });
  });

  revalidatePath(`/klienti/${puvodni.client.id}`);
  revalidatePath("/dashboard");

  return { ok: true, id: puvodni.id, zprava: "Hovor je upravený." };
}

/**
 * Odložení hovoru do koše.
 *
 * **Nic se z databáze nemaže** (CLAUDE.md) — hovor jen dostane značku
 * `deletedAt`, čímž zmizí z časové osy klienta, ze záložky Hovory
 * i z čísel na Dashboardu. Řádek zůstává a administrátor ho umí vrátit
 * ze Smazaných.
 *
 * Uživateli se o koši nepíše: potvrzovací okno mluví o tom, že akci
 * nelze vzít zpět, a je to tak schválně.
 */
export async function smazHovor(id: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const kdo = z.string().trim().min(1).max(64).safeParse(id);
  if (!kdo.success) return { ok: false, chyba: "Neplatný hovor." };

  const hovor = await hovorKUprave(viewer, kdo.data);
  if (!hovor) return { ok: false, chyba: "Takový hovor neexistuje." };

  await db.$transaction(async (tx) => {
    await tx.call.update({ where: { id: hovor.id }, data: { deletedAt: new Date() } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "calls",
      entityId: hovor.id,
      action: "hovor.do-kose",
      before: {
        clientId: hovor.client.id,
        at: hovor.at.toISOString(),
        durationMin: hovor.durationMin,
        outcome: hovor.outcome,
        maPoznamku: hovor.note.length > 0,
      },
    });
  });

  revalidatePath(`/klienti/${hovor.client.id}`);
  revalidatePath("/klienti");
  revalidatePath("/hovory");
  revalidatePath("/smazane");
  revalidatePath("/dashboard");

  return { ok: true, zprava: "Hovor je smazaný." };
}

/**
 * Přepsání poznámky u hovoru z přehledu Hovory.
 *
 * Vlastní akce schválně: v tabulce se mění jediné pole a posílat kvůli
 * němu celý formulář hovoru by znamenalo přepsat i čas, délku a výsledek.
 *
 * **Smí to autor hovoru a administrátor** — stejně jako u úpravy celého
 * hovoru (Jakub, 9. 9. 2026). Ověřuje to `hovorKUprave()`, takže kdo na
 * hovor nemá nárok, se nedozví ani to, jestli existuje.
 */
export async function upravPoznamkuHovoru(idRaw: string, poznamkaRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný hovor." };

  const poznamka = z
    .string()
    .max(5000, "Poznámka je příliš dlouhá.")
    .safeParse(typeof poznamkaRaw === "string" ? poznamkaRaw : "");
  if (!poznamka.success) return { ok: false, chyba: poznamka.error.issues[0].message };

  const hovor = await hovorKUprave(viewer, id.data);
  if (!hovor) return { ok: false, chyba: "Takový hovor neexistuje." };

  const nova = poznamka.data.trim();
  if (nova === hovor.note) return { ok: true, id: hovor.id, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.call.update({ where: { id: hovor.id }, data: { note: nova } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "calls",
      entityId: hovor.id,
      action: "hovor.upraven",
      // Text poznámky se do logu nedává — bývá o tom, co klient řekl
      // (security_warnings.md, pravidlo 8).
      before: { maPoznamku: hovor.note.length > 0 },
      after: { maPoznamku: nova.length > 0 },
    });
  });

  revalidatePath("/hovory");
  revalidatePath(`/klienti/${hovor.client.id}`);

  return { ok: true, id: hovor.id, zprava: "Poznámka je uložená." };
}

/**
 * Doplnění délky hovoru z přehledu Hovory.
 *
 * Hovor zapsaný přesunem případu do fáze Kontakt má délku nula — systém
 * neví, jak dlouho se mluvilo, a nevymýšlí si. Obchodník ji doplní tady,
 * bez otevírání celého formuláře.
 *
 * **Smí to autor hovoru a administrátor**, stejně jako u poznámky.
 */
export async function upravDelkuHovoru(idRaw: string, minutyRaw: unknown): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = z.string().trim().min(1).max(64).safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný hovor." };

  const minuty = z.coerce
    .number()
    .int("Délka musí být celé číslo minut.")
    .min(0, "Délka nemůže být záporná.")
    .max(MAX_MINUT, `Hovor delší než ${MAX_MINUT} minut je nejspíš překlep.`)
    .safeParse(minutyRaw);
  if (!minuty.success) return { ok: false, chyba: minuty.error.issues[0].message };

  const hovor = await hovorKUprave(viewer, id.data);
  if (!hovor) return { ok: false, chyba: "Takový hovor neexistuje." };

  if (minuty.data === hovor.durationMin) {
    return { ok: true, id: hovor.id, zprava: "Nic se nezměnilo." };
  }

  await db.$transaction(async (tx) => {
    await tx.call.update({ where: { id: hovor.id }, data: { durationMin: minuty.data } });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "calls",
      entityId: hovor.id,
      action: "hovor.upraven",
      before: { minut: hovor.durationMin },
      after: { minut: minuty.data },
    });
  });

  revalidatePath("/hovory");
  revalidatePath(`/klienti/${hovor.client.id}`);

  return { ok: true, id: hovor.id, zprava: `Délka je ${minuty.data} min.` };
}
