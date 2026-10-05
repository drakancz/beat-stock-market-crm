/**
 * Daň z přidané hodnoty.
 *
 * Ceny se do systému **ukládají bez DPH** a k produktu se vybírá jedna ze
 * tří sazeb (Jakub, 10. 9. 2026). Cena s DPH se z nich dopočítává; nikde
 * se neukládá, aby se po změně sazby v Nastavení nerozešla s tou bez daně.
 * Zadat jde od 27. 9. 2026 i cenu s DPH — přepočítá ji `bezDph()`.
 *
 * **Všechny hodnoty zakázek a statistiky se počítají bez DPH.** Cena
 * s daní je jen doplňující údaj — kolik zaplatí klient.
 *
 * Výpočet je tady, ne rozepsaný po obrazovkách, ať se všude zaokrouhluje
 * stejně.
 */

/** Zaokrouhlení na haléře. Peníze se nikdy nenechávají s plovoucím zbytkem. */
const naHalere = (castka: number) => Math.round(castka * 100) / 100;

/** Z ceny bez DPH spočítá cenu včetně daně. Sazba je v procentech (`21`). */
export function sDph(bezDane: number, sazbaProcent: number): number {
  return naHalere(bezDane * (1 + sazbaProcent / 100));
}

/**
 * Z ceny včetně DPH spočítá cenu bez daně (Jakub, 27. 9. 2026 — ceník se
 * zadává i s DPH). Ukládá se jen cena bez DPH, takže se hledá taková na
 * haléře, ze které `sDph()` dá **přesně zadanou cenu** — jinak by ze
 * zadaných 199 Kč mohlo v ceníku vyjít 198,99 Kč. Když taková neexistuje
 * (vzácné kombinace sazby a ceny), vrátí se prostě zaokrouhlený podíl.
 */
export function bezDph(sDani: number, sazbaProcent: number): number {
  const odhad = naHalere(sDani / (1 + sazbaProcent / 100));
  for (const kandidat of [odhad, naHalere(odhad - 0.01), naHalere(odhad + 0.01)]) {
    if (sDph(kandidat, sazbaProcent) === naHalere(sDani)) return kandidat;
  }
  return odhad;
}

/** Kolik k ceně bez DPH přibude na dani. */
export function castkaDph(bezDane: number, sazbaProcent: number): number {
  return naHalere(sDph(bezDane, sazbaProcent) - bezDane);
}

const procenta = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });

/** Sazba tak, jak se píše do rozhraní: `21 %`, `12,5 %`. */
export function popisSazby(sazbaProcent: number): string {
  return `${procenta.format(sazbaProcent)} %`;
}

/* ---------- Cena položky objednávky ---------- */

interface Cislo {
  toNumber(): number;
}

/** Položka objednávky s cenou uloženou ve chvíli objednávky (od 30. 9. 2026). */
interface PolozkaSCenou {
  netPrice: Cislo | null;
  vatPercent: Cislo | null;
  product: { netPrice: Cislo; vatRate?: { rate: Cislo } };
}

/**
 * Cena za kus bez DPH — **ze chvíle objednávky** (`order_items.netPrice`),
 * ne z dnešního ceníku (Jakub, 30. 9. 2026). Ceník je jen záloha pro
 * položku, které by databáze cenu nedoplnila (spouštěč `order_items_cena`
 * ji doplňuje vždy).
 */
export function cenaPolozkyBezDph(polozka: PolozkaSCenou): number {
  return (polozka.netPrice ?? polozka.product.netPrice).toNumber();
}

/** Cena za kus s DPH — uloženou sazbou ze chvíle objednávky. */
export function cenaPolozkySDph(polozka: PolozkaSCenou): number {
  const sazba = polozka.vatPercent ?? polozka.product.vatRate?.rate;
  return sDph(cenaPolozkyBezDph(polozka), sazba?.toNumber() ?? 0);
}
