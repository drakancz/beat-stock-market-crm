import { db } from "@/lib/db";
import { sDph } from "@/lib/dph";
import type { ProductKind } from "@/generated/prisma/enums";

/**
 * Ceník pro Landing Page (`GET /api/objednavky/cenik`, krok 1A, Jakub
 * 25. 10. 2026).
 *
 * **Kdo ho vidí:** jen Landing Page, která zná klíč `ORDER_API_KEY`
 * (stejný jako u objednávek — patří stejnému webu). Nikdo ho přes tuhle
 * adresu nemění, nepřihlášený bez klíče nedostane nic. Ceny se dál mění
 * jen v CRM (Produkty, administrátor) a na web se propíšou samy.
 *
 * Vrací **jen nabídku**: prodávané a nesmazané produkty. Nic o klientech,
 * objednávkách ani o tom, kolik se čeho prodalo. Výčet polí je schválně
 * pevný — nový sloupec v ceníku se na web nedostane, dokud ho sem někdo
 * vědomě nepřidá.
 */

export interface ProduktNaWebu {
  id: string;
  nazev: string;
  druh: ProductKind;
  cenaBezDph: number;
  sazbaDph: number;
  /** Kolik zaplatí zákazník — stejný výpočet jako v klientské části. */
  cenaSDph: number;
  mena: string;
  /** Na kolik měsíců produkt platí; `null` = nekončí (kurz, konzultace). */
  platnostMesicu: number | null;
  /** Odkaz na stránku produktu, když ho administrátor vyplnil. */
  odkaz: string | null;
}

export async function cenikProWeb(): Promise<ProduktNaWebu[]> {
  const produkty = await db.product.findMany({
    where: { active: true, deletedAt: null },
    orderBy: [{ kind: "asc" }, { netPrice: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      netPrice: true,
      currency: true,
      validityMonths: true,
      url: true,
      vatRate: { select: { rate: true } },
    },
  });

  return produkty.map((produkt) => {
    const cenaBezDph = Number(produkt.netPrice);
    const sazbaDph = Number(produkt.vatRate.rate);
    return {
      id: produkt.id,
      nazev: produkt.name,
      druh: produkt.kind,
      cenaBezDph,
      sazbaDph,
      cenaSDph: sDph(cenaBezDph, sazbaDph),
      mena: produkt.currency,
      platnostMesicu: produkt.validityMonths,
      odkaz: produkt.url,
    };
  });
}
