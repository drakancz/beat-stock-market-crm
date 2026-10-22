import { db } from "@/lib/db";
import { posunDne } from "@/lib/obdobi";
import { popisSlevy } from "@/lib/slevove-kody";

/**
 * „Doporuč přítele“ v klientské části (Jakub, 19. 10. 2026). **Jen klient,
 * kterého administrátor zapsal jako doporučitele** (Produkty →
 * Doporučitelé); ostatní nic nevidí. Ukazuje se jeho kód, sleva pro
 * kamaráda, procento odměny, **počet** přivedených (bez jmen — to jsou
 * cizí osobní údaje) a součty odměn. Data vždy podle `clientId`
 * z přihlášení.
 */

export interface KodDoporucitele {
  kod: string;
  sleva: string;
  /** Konec platnosti (začátek posledního dne), nebo `null`. */
  platiDo: Date | null;
  /** Kód už nejde použít (vyčerpaný počet použití). */
  vycerpany: boolean;
}

export interface DoporuceniKlienta {
  procento: number;
  kody: KodDoporucitele[];
  privedeno: number;
  vyplaceno: { pocet: number; castka: number };
  cekaNaVyplatu: { pocet: number; castka: number };
}

export async function nactiDoporuceniKlienta(
  clientId: string,
  ted = new Date(),
): Promise<DoporuceniKlienta | null> {
  const doporucitel = await db.referrer.findFirst({
    where: { clientId, deletedAt: null },
    select: {
      rewardPercent: true,
      kody: {
        where: {
          deletedAt: null,
          OR: [{ validFrom: null }, { validFrom: { lte: ted } }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          code: true,
          kind: true,
          value: true,
          validTo: true,
          maxUses: true,
          _count: { select: { objednavky: { where: { deletedAt: null } } } },
        },
      },
      _count: { select: { privedeni: { where: { deletedAt: null } } } },
      odmeny: { select: { amount: true, paidOutAt: true } },
    },
  });
  if (!doporucitel) return null;

  const kody = doporucitel.kody
    // `validTo` je začátek posledního dne — platí ještě celý ten den.
    .filter((kod) => !kod.validTo || ted < posunDne(kod.validTo, 1))
    .map((kod) => ({
      kod: kod.code,
      sleva: popisSlevy(kod.kind, kod.value.toNumber()),
      platiDo: kod.validTo,
      vycerpany: kod.maxUses !== null && kod._count.objednavky >= kod.maxUses,
    }));

  const soucet = (vyplacene: boolean) => {
    const odmeny = doporucitel.odmeny.filter((o) => (o.paidOutAt !== null) === vyplacene);
    return {
      pocet: odmeny.length,
      castka: odmeny.reduce((celkem, o) => celkem + o.amount.toNumber(), 0),
    };
  };

  return {
    procento: doporucitel.rewardPercent.toNumber(),
    kody,
    privedeno: doporucitel._count.privedeni,
    vyplaceno: soucet(true),
    cekaNaVyplatu: soucet(false),
  };
}
