/** Formátování čísel a dat. Všude v systému stejné, ať se čísla čtou jednotně. */

import { sjednotTelefon } from "@/lib/telefon";

const money = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeMoney = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const percentFormat = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  CZK: "Kč",
};

/** Například `21 327,50 $`. Záporná čísla se znaménkem. */
export function formatMoney(value: number, currency: string, options?: { signed?: boolean }) {
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const sign = options?.signed && value > 0 ? "+" : "";
  return `${sign}${money.format(value)} ${symbol}`;
}

/** Celé koruny bez haléřů — pro ceníky. */
export function formatPrice(value: number, currency: string) {
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  return `${wholeMoney.format(value)} ${symbol}`;
}

/** Délka v minutách: `45 min`, `2 h 5 min`. */
export function formatMinuty(minut: number) {
  const cele = Math.round(minut);
  if (cele < 1) return "méně než minuta";

  const hodin = Math.floor(cele / 60);
  const zbytek = cele % 60;
  if (hodin === 0) return `${zbytek} min`;
  return zbytek === 0 ? `${hodin} h` : `${hodin} h ${zbytek} min`;
}

/** Například `+12,4 %`. */
export function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percentFormat.format(value)} %`;
}

/** `2026-08-27` → `27. 8. 2026`. Zvládne i `2026-08-27 10:20`. */
export function formatDate(value: string) {
  const [datePart] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day}. ${month}. ${year}`;
}

/** `2026-08-27 10:20` → `27. 8. 2026, 10:20`. */
export function formatDateTime(value: string) {
  const [datePart, timePart] = value.split(" ");
  const date = formatDate(datePart);
  return timePart ? `${date}, ${timePart}` : date;
}

/**
 * Čas se vždycky přepočítává do **pražského pásma**, ne do pásma stroje.
 *
 * Bez toho se datum na serveru a v prohlížeči rozejde: kontejner běží
 * v UTC, lidé sedí v Praze — a React pak hlásí, že se vykreslený text
 * neshoduje (chyba „Hydration failed"). Firma je česká, takže je pražský
 * čas i věcně správně: hovor v 17:31 má být 17:31 pro každého, kdo se do
 * systému podívá.
 */
const PRAZSKY_CAS = "Europe/Prague";

/** Rozloží datum na části v pražském čase. `Intl` je tu jediný spolehlivý zdroj. */
function castiVPraze(hodnota: Date) {
  const casti = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: PRAZSKY_CAS,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(hodnota);

  const najdi = (typ: Intl.DateTimeFormatPartTypes) =>
    casti.find((cast) => cast.type === typ)?.value ?? "";

  return {
    den: Number(najdi("day")),
    mesic: Number(najdi("month")),
    rok: Number(najdi("year")),
    hodina: najdi("hour"),
    minuta: najdi("minute"),
  };
}

/** Datum z databáze: `27. 8. 2026`. */
export function formatDatum(hodnota: Date) {
  const { den, mesic, rok } = castiVPraze(hodnota);
  return `${den}. ${mesic}. ${rok}`;
}

/** Datum a čas z databáze: `27. 8. 2026, 10:20`. */
export function formatDatumCas(hodnota: Date) {
  const { hodina, minuta } = castiVPraze(hodnota);
  return `${formatDatum(hodnota)}, ${hodina}:${minuta}`;
}

/**
 * Telefon k zobrazení: `+420 601 555 123`.
 *
 * Od 26. 9. 2026 se telefon ukládá už sjednocený (`src/lib/telefon.ts`),
 * takže tohle je jen pojistka pro číslo, které by se do databáze dostalo
 * jinudy. Co nejde sjednotit, se ukáže, jak je.
 */
export function formatTelefon(telefon: string): string {
  return sjednotTelefon(telefon) ?? telefon;
}
