import type { ProductKind, ProgramAccess, OrderStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { cenaPolozkySDph } from "@/lib/dph";
import { dnesniZacatek } from "@/lib/platnost";
import { maPlatnost } from "@/lib/types";

/**
 * Data pro klientskou část (krok 3A, část 2, Jakub 30. 9. 2026).
 *
 * **Klient vidí jen sebe.** Každý dotaz tady bere `clientId` z přihlášení
 * (`requireKlient()` → `klient.clientId`), nikdy z adresy ani z formuláře
 * (security_warnings.md, pravidlo 5). Co klient **nevidí nikdy**:
 * poznámky, hovory, úkoly, přílohy, kdo z týmu co dělal, ceny bez DPH.
 *
 * Smazané objednávky se nepočítají ani neukazují — stejně jako v CRM.
 */

export interface ObjednavkaKlienta {
  id: string;
  number: string;
  status: OrderStatus;
  currency: string;
  createdAt: Date;
  paidAt: Date | null;
  polozky: { name: string; quantity: number; cenaSDph: number }[];
  celkemSDph: number;
}

export interface ProduktKlienta {
  productId: string;
  name: string;
  kind: ProductKind;
  /** `null` = produkt bez platnosti (kurz napořád, konzultace jednorázově). */
  do: Date | null;
  skoncilo: boolean;
}

export interface PrehledKlienta {
  udaje: {
    name: string;
    email: string;
    phone: string | null;
    consentMarketingAt: Date | null;
    programAccess: ProgramAccess;
  };
  objednavky: ObjednavkaKlienta[];
  produkty: ProduktKlienta[];
}

export async function nactiPrehledKlienta(clientId: string): Promise<PrehledKlienta | null> {
  const [klient, objednavky, platnosti] = await Promise.all([
    db.client.findFirst({
      where: { id: clientId, deletedAt: null, mergedIntoId: null },
      select: {
        name: true,
        email: true,
        phone: true,
        consentMarketingAt: true,
        programAccess: true,
      },
    }),
    db.order.findMany({
      where: { clientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        items: {
          orderBy: { product: { name: "asc" } },
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: {
              select: {
                id: true,
                name: true,
                kind: true,
                netPrice: true,
                vatRate: { select: { rate: true } },
              },
            },
          },
        },
      },
    }),
    db.productValidity.findMany({
      where: { clientId, validUntil: { not: null } },
      select: { productId: true, validUntil: true },
    }),
  ]);

  if (!klient) return null;

  const seznam: ObjednavkaKlienta[] = objednavky.map((objednavka) => {
    const polozky = objednavka.items.map((polozka) => ({
      name: polozka.product.name,
      quantity: polozka.quantity,
      // Cena s DPH ze chvíle objednávky — změna ceníku ji nepřepíše.
      cenaSDph: cenaPolozkySDph(polozka),
    }));
    return {
      id: objednavka.id,
      number: objednavka.number,
      status: objednavka.status,
      currency: objednavka.currency,
      createdAt: objednavka.createdAt,
      paidAt: objednavka.paidAt,
      polozky,
      celkemSDph: polozky.reduce((soucet, p) => soucet + p.quantity * p.cenaSDph, 0),
    };
  });

  // Co má klient zaplacené: každý produkt jednou. Platnost z tabulky
  // `product_validities` (počítá ji `prepocitejPlatnost()`), produkty bez
  // platnosti (kurz, konzultace) bez data.
  const konce = new Map(platnosti.map((radek) => [radek.productId, radek.validUntil!]));
  const dnes = dnesniZacatek().getTime();
  const produkty = new Map<string, ProduktKlienta>();

  for (const objednavka of objednavky) {
    if (objednavka.status !== "ZAPLACENO") continue;
    for (const { product } of objednavka.items) {
      if (produkty.has(product.id)) continue;
      // Bez řádku platnosti = produkt nekončí (členství bez délky
      // v ceníku je „Neomezeno", kurz vždy, konzultace je jednorázová).
      const konec = maPlatnost(product.kind) ? (konce.get(product.id) ?? null) : null;
      produkty.set(product.id, {
        productId: product.id,
        name: product.name,
        kind: product.kind,
        do: konec,
        skoncilo: konec !== null && konec.getTime() < dnes,
      });
    }
  }

  return {
    udaje: klient,
    objednavky: seznam,
    // Běžící nahoře, skončené dole.
    produkty: [...produkty.values()].sort((a, b) => Number(a.skoncilo) - Number(b.skoncilo)),
  };
}
