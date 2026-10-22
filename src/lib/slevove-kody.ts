import { z } from "zod";

import type { Transakce } from "@/lib/audit";
import { db } from "@/lib/db";
import { bezDph, sDph } from "@/lib/dph";
import { formatDatum } from "@/lib/format";
import { posunDne } from "@/lib/obdobi";

/**
 * Slevové kódy (Fáze 5A, Jakub 14. 10. 2026).
 *
 * **Slevu počítá vždycky CRM.** Landing Page posílá jen kód — kolik ubere,
 * se spočítá tady z ceníku, stejně jako se z požadavku nikdy nebere cena
 * (`src/lib/objednavky.ts`, pravidlo 2). Tutéž funkci volá příjem
 * objednávky i dotaz „ověř kód“ (`POST /api/objednavky/kod`), takže web
 * zákazníkovi ukáže přesně tu cenu, kterou pak CRM zapíše.
 *
 * Pravidla výpočtu:
 *
 * - **Procenta** se berou z ceny s DPH za kus a zaokrouhlí na haléře —
 *   zákazník vidí kulatou cenu s DPH, bez DPH se dopočítá (`bezDph()`).
 * - **Částka je s DPH** („−500 Kč“, jak ji vidí zákazník). Na víc produktů
 *   se rozpočítá podle jejich ceny a nikdy nepřesáhne cenu, na kterou
 *   se vztahuje — cena po slevě neklesne pod nulu.
 * - Kód omezený na produkty zlevní jen ty; objednávka, ve které žádný
 *   z nich není, se odmítne.
 * - **Neplatný kód objednávku odmítne** (Jakub, 14. 10. 2026) — kdyby se
 *   přijala bez slevy, zákazník by zaplatil víc, než mu web slíbil.
 */

/** Kód z formuláře nebo z požadavku: velká písmena, číslice, `-` a `_`. */
export function normalizujKod(text: string): string {
  return text.trim().toUpperCase();
}

export const kodSchema = z
  .string()
  .trim()
  .min(3, "Kód musí mít aspoň 3 znaky.")
  .max(40, "Kód může mít nejvýš 40 znaků.")
  .transform(normalizujKod)
  .refine(
    (kod) => /^[A-Z0-9_-]+$/.test(kod),
    "Kód smí obsahovat jen písmena bez diakritiky, číslice, pomlčku a podtržítko.",
  );

/** Položka objednávky, na kterou se sleva počítá. */
export interface RadekKSleve {
  productId: string;
  quantity: number;
}

/** Cena položky, kterou má objednávka zapsat. */
export interface CenaPolozky {
  /** Ceníková cena za kus bez DPH před slevou. */
  listNetPrice: number;
  /** Cena za kus bez DPH po slevě — ta se počítá do tržeb. */
  netPrice: number;
  vatPercent: number;
  /** Jestli se na položku sleva vztahovala. */
  zlevneno: boolean;
}

export type VysledekSlevy =
  | {
      ok: true;
      /** `referrerId` = komu kód patří (doporučení, 5A); `null` u běžné slevy. */
      kod: { id: string; code: string; referrerId: string | null };
      /** Ceny podle `productId`. */
      ceny: Map<string, CenaPolozky>;
      /** Součty za celou objednávku, s DPH. */
      celkemPredSlevou: number;
      celkemPoSleve: number;
      sleva: number;
    }
  | { ok: false; chyba: string };

/** Kdo objednává — kvůli „jednou na klienta“. Před založením klienta jen e-mail. */
export type Objednavajici = { klientId: string } | { email: string } | null;

const naHalere = (castka: number) => Math.round(castka * 100) / 100;

/*
 * Ne každou cenu s DPH jde přesně vyjádřit cenou bez DPH na haléře —
 * při 21 % se asi šestina haléřových částek přeskočí. Ukládá se cena bez
 * DPH, takže by z „6 292 Kč“ mohlo v CRM vyjít 6 291,99 Kč a zákazník by
 * viděl jinou cenu, než mu web slíbil. Proto se vybírají jen ceny, které
 * `sDph(bezDph(x)) === x` vrátí beze změny.
 */

/** Jde cenu s DPH v haléřích uložit přesně? */
function jePresna(halere: number, sazba: number): boolean {
  return Math.round(sDph(bezDph(halere / 100, sazba), sazba) * 100) === halere;
}

/** Nejbližší přesně uložitelná cena s DPH v haléřích, při shodě ta nižší. */
function nejblizsiPresna(halere: number, sazba: number): number {
  for (const posun of [0, -1, 1, -2, 2, -3, 3]) {
    const kandidat = halere + posun;
    if (kandidat >= 0 && jePresna(kandidat, sazba)) return kandidat;
  }
  return halere;
}

/**
 * Dorovná haléř či dva, o které se součet slev rozešel se zadanou částkou —
 * přesune je na položku (nebo dvě), která je unese přesně.
 */
function dorovnej(
  zbyva: number,
  polozky: { productId: string; quantity: number; vatPercent: number }[],
  nove: Map<string, number>,
) {
  const kusove = polozky.filter((polozka) => polozka.quantity === 1);
  const sedi = (polozka: (typeof kusove)[number], posun: number) => {
    const cena = nove.get(polozka.productId)! - posun;
    return cena >= 0 && jePresna(cena, polozka.vatPercent);
  };

  for (const polozka of kusove) {
    if (sedi(polozka, zbyva)) {
      nove.set(polozka.productId, nove.get(polozka.productId)! - zbyva);
      return;
    }
  }
  for (const a of kusove) {
    for (const b of kusove) {
      if (a === b) continue;
      for (const posun of [-3, -2, -1, 1, 2, 3]) {
        if (posun === zbyva || !sedi(a, posun) || !sedi(b, zbyva - posun)) continue;
        nove.set(a.productId, nove.get(a.productId)! - posun);
        nove.set(b.productId, nove.get(b.productId)! - (zbyva - posun));
        return;
      }
    }
  }
  // Nejde to (jediná položka po víc kusech) — zůstane rozdíl v haléřích.
}

/**
 * Ověří kód a spočítá ceny položek po slevě.
 *
 * Volá se i uvnitř transakce příjmu objednávky (`tx`), s uzamčeným řádkem
 * kódu — dvě souběžné objednávky tak nepřekročí „nejvýš N použití“.
 */
export async function spocitejSlevu(
  kodText: string,
  radky: RadekKSleve[],
  objednavajici: Objednavajici,
  klient: Transakce | typeof db = db,
  ted: Date = new Date(),
): Promise<VysledekSlevy> {
  const tvar = kodSchema.safeParse(kodText);
  if (!tvar.success) return { ok: false, chyba: "Slevový kód neexistuje." };

  const kod = await klient.discountCode.findFirst({
    where: { code: tvar.data, deletedAt: null },
    select: {
      id: true,
      code: true,
      kind: true,
      value: true,
      validFrom: true,
      validTo: true,
      maxUses: true,
      oncePerClient: true,
      referrerId: true,
      produkty: { select: { productId: true } },
    },
  });
  if (!kod) return { ok: false, chyba: "Slevový kód neexistuje." };

  if (kod.validFrom && ted < kod.validFrom) {
    return { ok: false, chyba: `Slevový kód platí až od ${formatDatum(kod.validFrom)}.` };
  }
  // `validTo` je začátek posledního dne — platí ještě celý ten den.
  if (kod.validTo && ted >= posunDne(kod.validTo, 1)) {
    return { ok: false, chyba: "Platnost slevového kódu skončila." };
  }

  if (kod.maxUses !== null) {
    const pouzito = await klient.order.count({
      where: { discountCodeId: kod.id, deletedAt: null },
    });
    if (pouzito >= kod.maxUses) return { ok: false, chyba: "Slevový kód je už vyčerpaný." };
  }

  if (kod.oncePerClient && objednavajici) {
    const klientId =
      "klientId" in objednavajici
        ? objednavajici.klientId
        : (
            await klient.client.findUnique({
              where: { email: objednavajici.email.toLowerCase() },
              select: { id: true },
            })
          )?.id;
    if (klientId) {
      const uz = await klient.order.count({
        where: { discountCodeId: kod.id, clientId: klientId, deletedAt: null },
      });
      if (uz > 0) return { ok: false, chyba: "Tento slevový kód už zákazník použil." };
    }
  }

  // Ceny z ceníku ve chvíli objednávky — stejné, jaké by doplnil spouštěč
  // `order_items_cena`.
  const produkty = await klient.product.findMany({
    where: { id: { in: radky.map((radek) => radek.productId) } },
    select: { id: true, netPrice: true, vatRate: { select: { rate: true } } },
  });
  const podleId = new Map(produkty.map((produkt) => [produkt.id, produkt]));

  const omezeni = new Set(kod.produkty.map((vazba) => vazba.productId));
  const polozky = radky.map((radek) => {
    const produkt = podleId.get(radek.productId);
    if (!produkt) throw new Error("Produkt objednávky chybí v ceníku.");
    const listNetPrice = produkt.netPrice.toNumber();
    const vatPercent = produkt.vatRate.rate.toNumber();
    return {
      ...radek,
      listNetPrice,
      vatPercent,
      brutto: sDph(listNetPrice, vatPercent),
      zlevneno: omezeni.size === 0 || omezeni.has(radek.productId),
    };
  });

  const zlevnene = polozky.filter((polozka) => polozka.zlevneno && polozka.brutto > 0);
  if (!polozky.some((polozka) => polozka.zlevneno)) {
    return { ok: false, chyba: "Slevový kód se nevztahuje na objednané produkty." };
  }

  const hodnota = kod.value.toNumber();
  /** Nová cena za kus s DPH v haléřích podle `productId`. */
  const nove = new Map<string, number>();
  const halere = (polozka: { brutto: number }) => Math.round(polozka.brutto * 100);

  if (kod.kind === "PROCENTA") {
    for (const polozka of zlevnene) {
      const cil = Math.round(halere(polozka) * (1 - hodnota / 100));
      nove.set(polozka.productId, nejblizsiPresna(cil, polozka.vatPercent));
    }
  } else {
    // Částka s DPH rozpočítaná podle ceny položek, v haléřích. Co se na
    // jedné položce zaokrouhlí, dorovná se na další, takže součet slev je
    // přesně zadaná částka.
    const celkem = zlevnene.reduce((soucet, p) => soucet + halere(p) * p.quantity, 0);
    const slevaHaleru = Math.min(Math.round(hodnota * 100), celkem);
    let zbyva = slevaHaleru;
    zlevnene.forEach((polozka, poradi) => {
      const naRadek =
        poradi === zlevnene.length - 1
          ? zbyva
          : Math.floor((slevaHaleru * halere(polozka) * polozka.quantity) / celkem);
      const zaKus = nejblizsiPresna(
        Math.max(0, halere(polozka) - Math.round(naRadek / polozka.quantity)),
        polozka.vatPercent,
      );
      nove.set(polozka.productId, zaKus);
      zbyva -= (halere(polozka) - zaKus) * polozka.quantity;
    });
    if (zbyva !== 0) dorovnej(zbyva, zlevnene, nove);
  }

  const ceny = new Map<string, CenaPolozky>();
  let celkemPredSlevou = 0;
  let celkemPoSleve = 0;

  for (const polozka of polozky) {
    const noveHalere = nove.get(polozka.productId);
    const brutto = noveHalere === undefined ? undefined : noveHalere / 100;
    const netPrice =
      brutto === undefined ? polozka.listNetPrice : bezDph(brutto, polozka.vatPercent);
    ceny.set(polozka.productId, {
      listNetPrice: polozka.listNetPrice,
      netPrice,
      vatPercent: polozka.vatPercent,
      zlevneno: brutto !== undefined,
    });
    celkemPredSlevou += polozka.quantity * polozka.brutto;
    celkemPoSleve += polozka.quantity * sDph(netPrice, polozka.vatPercent);
  }

  return {
    ok: true,
    kod: { id: kod.id, code: kod.code, referrerId: kod.referrerId },
    ceny,
    celkemPredSlevou: naHalere(celkemPredSlevou),
    celkemPoSleve: naHalere(celkemPoSleve),
    sleva: naHalere(celkemPredSlevou - celkemPoSleve),
  };
}

/** Popis slevy do rozhraní: „−20 %“, „−500 Kč“. */
export function popisSlevy(kind: "PROCENTA" | "CASTKA", hodnota: number): string {
  const cislo = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(hodnota);
  return kind === "PROCENTA" ? `−${cislo} %` : `−${cislo} Kč`;
}
