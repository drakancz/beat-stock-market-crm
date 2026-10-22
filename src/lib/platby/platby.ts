import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { cenaPolozkySDph } from "@/lib/dph";
import { vystavDobropis } from "@/lib/faktury/faktury";
import { zmenStavPlatby } from "@/lib/zaplaceni";

import {
  ChybaBrany,
  nastaveniGoPay,
  stavPlatbyGoPay,
  vratPlatbuGoPay,
  zalozPlatbuGoPay,
} from "./gopay";

/**
 * Platby objednávek přes bránu GoPay (Jakub, 19. 10. 2026).
 *
 * | Kdo           | Smí                                                         |
 * | ------------- | ----------------------------------------------------------- |
 * | klient        | zaplatit svou nezaplacenou objednávku (web, klientská část) |
 * | uživatel      | vidět stav platby u objednávky                              |
 * | administrátor | navíc vrátit peníze                                         |
 *
 * - **Oznámení brány se nevěří.** Brána pošle jen id platby; CRM si stav
 *   vždy zjistí přímo u GoPay (`stavPlatbyGoPay()`) a teprve pak objednávku
 *   zaplatí — přes `zmenStavPlatby()`, stejně jako ruční přepnutí.
 * - Částka je vždy z položek objednávky (cena s DPH ze chvíle nákupu, po
 *   slevě), nikdy z požadavku.
 * - Vrácení peněz vrací objednávku do stavu Nezaplaceno.
 */

/** Platba nezačne, když od objednávky uplynulo víc — připomínky běží 7 dní. */
const ZNOVU_POUZIT_MS = 30 * 60_000;

export function branaZapnuta(): boolean {
  return nastaveniGoPay() !== null;
}

function zakladniAdresa(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const naHalere = (castka: number) => Math.round(castka * 100);

/**
 * Adresa platební stránky pro nezaplacenou objednávku, nebo `null`, když
 * brána není zapnutá nebo objednávka zaplatit nejde. Nedávno založený
 * pokus se použije znovu (dvojklik nezaloží dvě platby).
 */
export async function odkazNaPlatbu(orderId: string): Promise<string | null> {
  const nastaveni = nastaveniGoPay();
  if (!nastaveni) return null;

  const objednavka = await db.order.findFirst({
    where: { id: orderId, deletedAt: null, status: { in: ["NOVA", "NEZAPLACENO"] } },
    select: {
      id: true,
      number: true,
      currency: true,
      client: { select: { email: true, deletedAt: true } },
      items: {
        select: {
          quantity: true,
          netPrice: true,
          vatPercent: true,
          product: {
            select: { name: true, netPrice: true, vatRate: { select: { rate: true } } },
          },
        },
      },
    },
  });
  if (!objednavka || objednavka.client.deletedAt || objednavka.items.length === 0) return null;

  const nedavna = await db.payment.findFirst({
    where: {
      orderId: objednavka.id,
      state: "CREATED",
      gwUrl: { not: null },
      createdAt: { gte: new Date(Date.now() - ZNOVU_POUZIT_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { gwUrl: true },
  });
  if (nedavna?.gwUrl) return nedavna.gwUrl;

  const polozky = objednavka.items.map((p) => ({
    nazev: p.product.name.slice(0, 250),
    castkaHalere: naHalere(cenaPolozkySDph(p)) * p.quantity,
    kusu: p.quantity,
  }));
  const castkaHalere = polozky.reduce((s, p) => s + p.castkaHalere, 0);
  if (castkaHalere <= 0) return null;

  const zakladni = zakladniAdresa();
  const platba = await zalozPlatbuGoPay(nastaveni, {
    cislo: objednavka.number,
    popis: `Objednávka ${objednavka.number}`,
    castkaHalere,
    mena: objednavka.currency,
    polozky,
    email: objednavka.client.email,
    navrat: `${zakladni}/ucet/platba`,
    oznameni: `${zakladni}/api/platby/gopay`,
  });

  await db.payment.create({
    data: {
      orderId: objednavka.id,
      provider: "GOPAY",
      providerId: platba.id,
      amount: castkaHalere / 100,
      currency: objednavka.currency,
      state: platba.stav,
      gwUrl: platba.gwUrl,
    },
  });
  return platba.gwUrl;
}

export interface VysledekOznameni {
  cislo: string;
  stav: string;
  zaplaceno: boolean;
}

/**
 * Zpracuje oznámení brány o platbě (`id` = id platby u GoPay). Stav se
 * zjistí u GoPay; zaplacená platba zaplatí objednávku. Neznámé id vrací
 * `null` — nic se nezapíše.
 */
export async function zpracujOznameni(providerId: string): Promise<VysledekOznameni | null> {
  const nastaveni = nastaveniGoPay();
  if (!nastaveni) return null;

  const platba = await db.payment.findUnique({
    where: { providerId },
    select: {
      id: true,
      orderId: true,
      amount: true,
      state: true,
      order: { select: { number: true } },
    },
  });
  if (!platba) return null;

  const uBrany = await stavPlatbyGoPay(nastaveni, providerId);
  const zaplaceno = uBrany.stav === "PAID";
  // Částka u brány musí sedět s tím, co CRM založilo.
  const sedi =
    uBrany.castkaHalere === null || uBrany.castkaHalere === naHalere(platba.amount.toNumber());

  if (uBrany.stav !== platba.state) {
    await db.payment.update({
      where: { id: platba.id },
      data: {
        state: uBrany.stav,
        ...(zaplaceno && platba.state !== "PAID" ? { paidAt: new Date() } : {}),
      },
    });
  }
  if (zaplaceno && sedi) {
    await zmenStavPlatby(platba.orderId, "ZAPLACENO", { userId: null, zdroj: "brana" });
  }
  return { cislo: platba.order.number, stav: uBrany.stav, zaplaceno: zaplaceno && sedi };
}

/**
 * Vrácení peněz za zaplacenou platbu — **jen administrátor** (kontroluje
 * volající akce). Objednávka se vrátí do stavu Nezaplaceno.
 */
export async function vratPenize(
  paymentId: string,
  adminId: string,
): Promise<{ ok: true; cislo: string } | { ok: false; chyba: string }> {
  const nastaveni = nastaveniGoPay();
  if (!nastaveni) return { ok: false, chyba: "Platební brána není zapnutá." };

  const platba = await db.payment.findFirst({
    where: { id: paymentId, state: "PAID", refundedAt: null },
    select: {
      id: true,
      providerId: true,
      amount: true,
      orderId: true,
      order: { select: { number: true } },
    },
  });
  if (!platba) return { ok: false, chyba: "Tahle platba se vrátit nedá." };

  try {
    await vratPlatbuGoPay(nastaveni, platba.providerId, naHalere(platba.amount.toNumber()));
  } catch (chyba) {
    return {
      ok: false,
      chyba: chyba instanceof ChybaBrany ? chyba.message : "Bránu se nepodařilo zastihnout.",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: platba.id },
      data: { state: "REFUNDED", refundedAt: new Date(), refundedById: adminId },
    });
    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "orders",
      entityId: platba.orderId,
      action: "objednavka.platba-vracena",
      after: { cislo: platba.order.number, castka: platba.amount.toString() },
    });
  });
  await zmenStavPlatby(platba.orderId, "NEZAPLACENO", { userId: adminId });
  // Vrácené peníze = opravný daňový doklad k faktuře (19. 10. 2026).
  const faktura = await db.invoice.findFirst({
    where: { orderId: platba.orderId, kind: "FAKTURA", dobropisy: { none: {} } },
    select: { id: true },
  });
  if (faktura) await vystavDobropis(faktura.id, adminId);
  return { ok: true, cislo: platba.order.number };
}
