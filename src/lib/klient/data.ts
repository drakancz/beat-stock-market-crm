import type { ProductKind, ProgramAccess, OrderStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { cenaPolozkySDph, sDph } from "@/lib/dph";
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
  /** Už po slevě. */
  celkemSDph: number;
  /** Slevový kód (Fáze 5A, 14. 10. 2026) a kolik s DPH ubral. */
  sleva: { kod: string; castka: number } | null;
  /** Faktury a dobropisy k objednávce (19. 10. 2026). */
  doklady: { id: string; number: string; dobropis: boolean }[];
}

export interface ProduktKlienta {
  productId: string;
  name: string;
  kind: ProductKind;
  /** `null` = produkt bez platnosti (kurz napořád, konzultace jednorázově). */
  do: Date | null;
  skoncilo: boolean;
  /** Celé pražské dny do konce (0 = končí dnes); `null` bez konce nebo po něm. */
  zbyvaDni: number | null;
  /** Stránka produktu z ceníku (jen `https`) — odkaz Prodloužit. */
  url: string | null;
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
        discountCode: { select: { code: true } },
        // Faktury a dobropisy (19. 10. 2026) — klient stáhne své.
        faktury: { orderBy: { issuedAt: "asc" }, select: { id: true, number: true, kind: true } },
        items: {
          orderBy: { product: { name: "asc" } },
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            listNetPrice: true,
            product: {
              select: {
                id: true,
                name: true,
                kind: true,
                url: true,
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
      doklady: objednavka.faktury.map((f) => ({
        id: f.id,
        number: f.number,
        dobropis: f.kind === "DOBROPIS",
      })),
      celkemSDph: polozky.reduce((soucet, p) => soucet + p.quantity * p.cenaSDph, 0),
      sleva: objednavka.discountCode
        ? {
            kod: objednavka.discountCode.code,
            castka:
              Math.round(
                objednavka.items.reduce(
                  (soucet, polozka) =>
                    polozka.listNetPrice
                      ? soucet +
                        polozka.quantity *
                          (sDph(
                            polozka.listNetPrice.toNumber(),
                            polozka.vatPercent?.toNumber() ?? 0,
                          ) -
                            cenaPolozkySDph(polozka))
                      : soucet,
                  0,
                ) * 100,
              ) / 100,
          }
        : null,
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
        // `validUntil` je začátek posledního platného dne; zaokrouhlení
        // spolkne hodinu navíc nebo méně při změně času.
        zbyvaDni:
          konec !== null && konec.getTime() >= dnes
            ? Math.round((konec.getTime() - dnes) / 86_400_000)
            : null,
        url: product.url,
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
