"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prepocitejOdmenu } from "@/lib/doporuceni";
import { prepocitejPlatnost } from "@/lib/platnost";
import { viditelneObjednavky } from "@/lib/queries";
import { requireAdmin, requireViewer } from "@/lib/session";
import { fakturyZapnute, vystavDobropis, vystavFakturu } from "@/lib/faktury/faktury";
import { vratPenize } from "@/lib/platby/platby";
import { zmenStavPlatby } from "@/lib/zaplaceni";

/**
 * Co jde u objednávky změnit.
 *
 * Objednávku **nikdo v CRM nezakládá** (Jakub, 22. 9. 2026) — vytvoří ji
 * klient na Landing Page a CRM ji převezme přes `POST /api/objednavky`.
 * Co si klient objednal (produkty, cena, čas objednávky) se proto
 * nepřepisuje; je to záznam o uzavřené objednávce, ne rozjednaná zakázka.
 *
 * Pravidla, která tu platí bez výjimky:
 *
 * 1. **Stav a přístup do programu přepíná jen administrátor**
 *    (Jakub, 22. 9. 2026). Jsou to peníze a přístup k placenému obsahu;
 *    omylem kliknutý stav by někomu otevřel program zadarmo. Vynucuje to
 *    `requireAdmin()` na prvním řádku akce, ne skryté tlačítko
 *    (security.md, pravidlo 2).
 * 2. **Poznámku a smazání má ten, kdo objednávku vidí** — obchodník
 *    u svých klientů, manažer a administrátor u všech. Rozhoduje o tom
 *    podmínka v dotazu (`viditelneObjednavky()`), ne zobrazení
 *    (security_warnings.md, pravidlo 5).
 * 3. **Ceny se všude počítají bez DPH** (`src/lib/dph.ts`). Cena s daní
 *    je jen doplňující údaj v tabulce.
 * 4. **Zápis do auditního logu je součástí změny**, ve stejné transakci
 *    (pravidlo 7).
 */

export type Vysledek = { ok: true; id?: string; zprava: string } | { ok: false; chyba: string };

const ID = z.string().trim().min(1).max(64);
const STAVY = z.enum(["NOVA", "NEZAPLACENO", "ZAPLACENO"]);

/** Obnoví obrazovky, na kterých se objednávka může objevit. */
function obnovStranky(clientId: string) {
  revalidatePath("/objednavky");
  revalidatePath("/klienti");
  revalidatePath(`/klienti/${clientId}`);
  revalidatePath("/produkty");
  revalidatePath("/dashboard");
}

/* ---------- Stav objednávky ---------- */

/**
 * Přepnutí stavu objednávky. **Jen administrátor.**
 *
 * Až bude platební brána, bude stav nastavovat ona; tohle je ruční cesta
 * pro případ, kdy se platba spáruje jinak (převodem, reklamací).
 */
export async function zmenStavObjednavky(idRaw: string, stavRaw: string): Promise<Vysledek> {
  const viewer = await requireAdmin();

  const id = ID.safeParse(idRaw);
  const stav = STAVY.safeParse(stavRaw);
  if (!id.success || !stav.success) return { ok: false, chyba: "Neplatný požadavek." };

  const objednavka = await db.order.findFirst({
    where: { AND: [{ id: id.data }, viditelneObjednavky(viewer)] },
    select: { id: true, number: true, status: true, clientId: true, paidAt: true },
  });

  if (!objednavka) return { ok: false, chyba: "Taková objednávka neexistuje." };
  if (objednavka.status === stav.data) {
    return { ok: true, zprava: "Objednávka už v tomhle stavu je." };
  }

  // Zaplacení i návrat ze Zaplaceno jdou přes jedno místo (19. 10. 2026),
  // stejné jako u platební brány — `src/lib/zaplaceni.ts`.
  const zmena = await zmenStavPlatby(objednavka.id, stav.data, { userId: viewer.id });
  const odmena = zmena?.odmena ?? null;

  obnovStranky(objednavka.clientId);

  return {
    ok: true,
    zprava:
      odmena === "vyplacena-zustava"
        ? `Stav objednávky je změněný: ${objednavka.number}. Odměna doporučiteli z ní je už vyplacená — v přehledu zůstává.`
        : `Stav objednávky je změněný: ${objednavka.number}.`,
  };
}

/*
 * Přepínání přístupu do programu u objednávky tu bylo do 23. 9. 2026.
 * Přístup je od té doby jeden za klienta — `klienti/pristup-actions.ts`.
 */

/* ---------- Poznámka ---------- */

const poznamkaSchema = z.string().trim().max(2000, "Poznámka je příliš dlouhá.");

/**
 * Interní poznámka týmu k objednávce.
 *
 * Mění ji každý, kdo objednávku vidí — je to zápisník, ne údaj
 * o objednávce. **Do auditu se nepíše obsah**, jen že se poznámka
 * změnila (security_warnings.md, pravidlo 8).
 */
export async function ulozPoznamkuObjednavky(
  idRaw: string,
  poznamkaRaw: string,
): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = ID.safeParse(idRaw);
  const poznamka = poznamkaSchema.safeParse(poznamkaRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };
  if (!poznamka.success) {
    return { ok: false, chyba: poznamka.error.issues[0]?.message ?? "Poznámku nešlo uložit." };
  }

  const objednavka = await db.order.findFirst({
    where: { AND: [{ id: id.data }, viditelneObjednavky(viewer)] },
    select: { id: true, name: true, clientId: true },
  });

  if (!objednavka) {
    return { ok: false, chyba: "Taková objednávka neexistuje, nebo na ni nemáš přístup." };
  }

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: objednavka.id },
      data: { note: poznamka.data || null },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "orders",
      entityId: objednavka.id,
      action: "objednavka.poznamka-zmenena",
      after: { poznamka: poznamka.data ? "změněna" : "smazána" },
    });
  });

  obnovStranky(objednavka.clientId);

  return { ok: true, zprava: "Poznámka je uložená." };
}

/* ---------- Mazání ---------- */

/**
 * Odložení objednávky do koše.
 *
 * Smí to každý, kdo na objednávku vidí. Nemaže se: řádek i objednané
 * produkty zůstávají, objednávka jen zmizí ze seznamu a z karty klienta.
 * Vrátit ji jde ve Smazaných — o tom ale uživatel v rozhraní neví, texty
 * mluví o nevratném smazání (Jakubovo rozhodnutí 6. 9. 2026).
 */
export async function dejObjednavkuDoKose(idRaw: string): Promise<Vysledek> {
  const viewer = await requireViewer();

  const id = ID.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const objednavka = await db.order.findFirst({
    where: { AND: [{ id: id.data }, viditelneObjednavky(viewer)] },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      clientId: true,
      client: { select: { name: true } },
    },
  });

  if (!objednavka) {
    return { ok: false, chyba: "Taková objednávka neexistuje, nebo na ni nemáš přístup." };
  }

  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: objednavka.id }, data: { deletedAt: new Date() } });

    // Smazaná zaplacená objednávka se do platnosti členství nepočítá.
    if (objednavka.status === "ZAPLACENO") await prepocitejPlatnost(tx, objednavka.clientId);
    // Smazaná objednávka nevyplacenou odměnu doporučiteli nepotřebuje.
    await prepocitejOdmenu(tx, objednavka.id, viewer.id);

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "orders",
      entityId: objednavka.id,
      action: "objednavka.do-kose",
      before: {
        cislo: objednavka.number,
        name: objednavka.name,
        klient: objednavka.client.name,
        stav: objednavka.status,
      },
    });
  });

  obnovStranky(objednavka.clientId);
  revalidatePath("/smazane");

  return { ok: true, zprava: `Smazáno: objednávka ${objednavka.number}.` };
}

/* ---------- Vrácení platby přes bránu ---------- */

/**
 * Vrácení peněz za platbu přes GoPay (19. 10. 2026). **Jen administrátor**
 * — `requireAdmin()` na prvním řádku. Objednávka se vrátí do stavu
 * Nezaplaceno (s tím i platnost a odměna doporučiteli, jako při ručním
 * přepnutí).
 */
export async function vratitPenize(paymentIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(paymentIdRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const platba = await db.payment.findFirst({
    where: { id: id.data, order: viditelneObjednavky(admin) },
    select: { id: true, order: { select: { clientId: true } } },
  });
  if (!platba) return { ok: false, chyba: "Taková platba neexistuje." };

  const vysledek = await vratPenize(platba.id, admin.id);
  if (!vysledek.ok) return vysledek;
  obnovStranky(platba.order.clientId);
  return { ok: true, zprava: `Peníze jsou vrácené: objednávka ${vysledek.cislo}.` };
}

/* ---------- Faktury ---------- */

/**
 * Ruční vystavení faktury u zaplacené objednávky, která ji nemá — typicky
 * zaplacená před spuštěním faktur (Jakub, 19. 10. 2026). **Jen
 * administrátor.** Nové platby fakturu dostávají samy.
 */
export async function vystavitFakturu(orderIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(orderIdRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const objednavka = await db.order.findFirst({
    where: { AND: [{ id: id.data }, viditelneObjednavky(admin)] },
    select: { id: true, clientId: true, status: true },
  });
  if (!objednavka) return { ok: false, chyba: "Taková objednávka neexistuje." };
  if (objednavka.status !== "ZAPLACENO") {
    return { ok: false, chyba: "Fakturu jde vystavit jen k zaplacené objednávce." };
  }
  const zapnute = await fakturyZapnute();
  if (!zapnute.ok) {
    return {
      ok: false,
      chyba: `Faktury jsou vypnuté — v Nastavení → Firma chybí: ${zapnute.chybi.join(", ")}.`,
    };
  }

  const faktura = await vystavFakturu(objednavka.id, admin.id);
  if (!faktura) return { ok: false, chyba: "Fakturu se nepodařilo vystavit." };
  obnovStranky(objednavka.clientId);
  return {
    ok: true,
    zprava: faktura.nova
      ? `Faktura je vystavená: ${faktura.number}.`
      : `Faktura už existuje: ${faktura.number}.`,
  };
}

/** Dobropis k faktuře — **jen administrátor** (Jakub, 19. 10. 2026). */
export async function vystavitDobropis(fakturaIdRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();
  const id = ID.safeParse(fakturaIdRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const faktura = await db.invoice.findFirst({
    where: { id: id.data, kind: "FAKTURA", order: viditelneObjednavky(admin) },
    select: { id: true, order: { select: { clientId: true } } },
  });
  if (!faktura) return { ok: false, chyba: "Taková faktura neexistuje." };

  const vysledek = await vystavDobropis(faktura.id, admin.id);
  if (!vysledek.ok) return vysledek;
  obnovStranky(faktura.order.clientId);
  return { ok: true, zprava: `Dobropis je vystavený: ${vysledek.number}.` };
}
