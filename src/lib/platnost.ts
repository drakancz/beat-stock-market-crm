import type { Transakce } from "@/lib/audit";
import { dnesVPraze, jakoDen, zacatekDne } from "@/lib/obdobi";

/**
 * Platnost produktů — do kdy klientovi běží členství (Jakub, 24. 9. 2026).
 *
 * Pravidla, která Jakub vybral:
 *
 * 1. **Délka je u produktu v ceníku** v měsících (`products.validityMonths`),
 *    prázdná = produkt nekončí. Při zaplacení se opíše do položky
 *    objednávky, takže pozdější změna v ceníku už zaplacené nepřepíše.
 * 2. **Počítá se od zaplacení** (`orders.paidAt`) a **další zaplacení
 *    navazuje**: kdo prodlouží ještě před koncem, nepřijde o zaplacené dny.
 *    Víc kusů = víc období za sebou.
 * 3. **Ruční úprava konce je jen pro administrátora** — přebije platby
 *    před sebou, na platby po ní se navazuje.
 * 4. Úkol „zavolat kvůli prodloužení" zanikl 20. 10. 2026 (Jakub) — nevolá
 *    se. Klientovi dál chodí upozornění na konec členství (plánovač).
 *
 * **Konec se nikdy nepíše ručně do `validUntil`**, vždy přes
 * `prepocitejPlatnost()`. Volá se všude, kde se mění, co je zaplacené:
 * přepnutí stavu objednávky, smazání a obnovení objednávky, příjem
 * zaplacené objednávky z Landing Page, změna délky v ceníku a ruční úprava.
 *
 * **Kurz platí napořád** (Jakub, 27. 9. 2026): zakoupením kurzu má klient
 * doživotní přístup. **Konzultace je jednorázová** (Jakub, 28. 9. 2026).
 * Ani jeden proto délku nemá (`maPlatnost()` v `types.ts`, hlídá
 * `produkty/actions.ts`), a nemá řádek platnosti.
 */

/**
 * Zruší platnost produktu, který se stal kurzem nebo konzultací.
 *
 * Zahodí délku opsanou do zaplacených položek, spočítané konce u klientů
 * u klientů. Totéž
 * udělaly migrace `kurz_neomezeno` a `konzultace_bez_platnosti`
 * s produkty, které už v ceníku byly.
 */
export async function zrusPlatnostProduktu(tx: Transakce, productId: string): Promise<void> {
  await tx.orderItem.updateMany({ where: { productId }, data: { validityMonths: null } });

  await tx.productValidity.deleteMany({ where: { productId } });
}

/** Začátek dnešního dne v Praze. Platnost „do 24. 9." platí celý ten den. */
export function dnesniZacatek(): Date {
  const { rok, mesic, den } = dnesVPraze();
  return zacatekDne(rok, mesic, den);
}

/** Začátek pražského dne, do kterého okamžik patří. */
export function zacatekDneOkamziku(okamzik: Date): Date {
  const [rok, mesic, den] = jakoDen(okamzik).split("-").map(Number);
  return zacatekDne(rok, mesic, den);
}

/**
 * Přičte kalendářní měsíce ke dni.
 *
 * Den v měsíci zůstává, jen když v cílovém měsíci existuje: 31. 1. +
 * 1 měsíc je 28. (29.) 2., ne 3. 3. — jinak by se konec členství
 * posouval o dny, které klient nezaplatil.
 */
export function pridejMesice(zaklad: Date, mesicu: number): Date {
  const [rok, mesic, den] = jakoDen(zaklad).split("-").map(Number);
  const index = mesic - 1 + mesicu;
  const cilovyRok = rok + Math.floor(index / 12);
  const cilovyMesic = (((index % 12) + 12) % 12) + 1;
  const dnuVMesici = new Date(Date.UTC(cilovyRok, cilovyMesic, 0)).getUTCDate();
  return zacatekDne(cilovyRok, cilovyMesic, Math.min(den, dnuVMesici));
}

/**
 * Opíše délku platnosti z ceníku do položek objednávky (při zaplacení),
 * nebo ji zahodí (při návratu ze Zaplaceno).
 *
 * Opisuje se jen tam, kde položka délku ještě nemá a produkt ji má —
 * produkt bez délky nechá položku prázdnou, takže až ji administrátor
 * zadá, projeví se i u objednávek zaplacených dřív.
 */
export async function opisDelkuPlatnosti(
  tx: Transakce,
  orderId: string,
  zaplaceno: boolean,
): Promise<void> {
  if (!zaplaceno) {
    await tx.orderItem.updateMany({ where: { orderId }, data: { validityMonths: null } });
    return;
  }

  const polozky = await tx.orderItem.findMany({
    where: { orderId, validityMonths: null, product: { validityMonths: { not: null } } },
    select: { id: true, product: { select: { validityMonths: true } } },
  });

  for (const polozka of polozky) {
    await tx.orderItem.update({
      where: { id: polozka.id },
      data: { validityMonths: polozka.product.validityMonths },
    });
  }
}

/** Jedno zaplacení produktu: kdy a na kolik měsíců (už vynásobené kusy). */
export interface Platba {
  kdy: Date;
  mesicu: number;
}

/**
 * Konec platnosti z plateb a ruční úpravy.
 *
 * Platby se berou v pořadí, jak přišly. Každá začíná dnem zaplacení,
 * nebo koncem předchozího období, když ještě běží (navazování). Ruční
 * úprava nastaví konec natvrdo a platby, které přišly před ní, už
 * nepočítá — administrátor je při úpravě viděl.
 */
export function spocitejKonec(
  platby: Platba[],
  rucne: { konec: Date; zadano: Date } | null,
): Date | null {
  let konec: Date | null = rucne?.konec ?? null;

  const serazene = [...platby].sort((a, b) => a.kdy.getTime() - b.kdy.getTime());
  for (const platba of serazene) {
    if (platba.mesicu <= 0) continue;
    if (rucne && platba.kdy.getTime() <= rucne.zadano.getTime()) continue;

    const denPlatby = zacatekDneOkamziku(platba.kdy);
    const zacatek = konec && konec.getTime() > denPlatby.getTime() ? konec : denPlatby;
    konec = pridejMesice(zacatek, platba.mesicu);
  }

  return konec;
}

/**
 * Spočítá znovu platnost všech produktů jednoho klienta a uloží ji.
 *
 * Volá se uvnitř transakce se změnou, která ji vyvolala — platnost se tak
 * nikdy nerozejde se stavem objednávek. Zaplacené objednávky v koši se
 * nepočítají, stejně jako u tržeb.
 */
export async function prepocitejPlatnost(tx: Transakce, clientId: string): Promise<void> {
  // Dotazy v transakci po sobě, ne přes Promise.all: transakce má jedno
  // spojení a pg souběžné dotazy na něm hlásí (od pg 9 to bude chyba).
  const polozky = await tx.orderItem.findMany({
    where: {
      order: { clientId, status: "ZAPLACENO", deletedAt: null, paidAt: { not: null } },
    },
    select: {
      productId: true,
      quantity: true,
      validityMonths: true,
      product: { select: { validityMonths: true } },
      order: { select: { paidAt: true } },
    },
  });
  const radky = await tx.productValidity.findMany({
    where: { clientId },
    select: {
      id: true,
      productId: true,
      validUntil: true,
      manualUntil: true,
      manualAt: true,
    },
  });

  const platbyPodleProduktu = new Map<string, Platba[]>();
  for (const polozka of polozky) {
    // Délka opsaná při zaplacení; když produkt tehdy délku neměl, platí
    // jeho současná (starší objednávky z doby před platností).
    const mesicu =
      (polozka.validityMonths ?? polozka.product.validityMonths ?? 0) * polozka.quantity;
    if (mesicu <= 0 || !polozka.order.paidAt) continue;

    const seznam = platbyPodleProduktu.get(polozka.productId) ?? [];
    seznam.push({ kdy: polozka.order.paidAt, mesicu });
    platbyPodleProduktu.set(polozka.productId, seznam);
  }

  const radekProduktu = new Map(radky.map((radek) => [radek.productId, radek]));
  const produkty = new Set([...platbyPodleProduktu.keys(), ...radekProduktu.keys()]);

  for (const productId of produkty) {
    const radek = radekProduktu.get(productId);
    const rucne =
      radek?.manualUntil && radek.manualAt
        ? { konec: radek.manualUntil, zadano: radek.manualAt }
        : null;
    const konec = spocitejKonec(platbyPodleProduktu.get(productId) ?? [], rucne);

    if (!radek) {
      if (konec)
        await tx.productValidity.create({ data: { clientId, productId, validUntil: konec } });
      continue;
    }

    if ((radek.validUntil?.getTime() ?? null) === (konec?.getTime() ?? null)) continue;

    await tx.productValidity.update({ where: { id: radek.id }, data: { validUntil: konec } });
  }
}
