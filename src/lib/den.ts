/**
 * Kalendářní dny v pražském čase — bez zodu a bez serverových závislostí,
 * aby šly použít i v prohlížeči (okno úkolu, úprava platnosti). Kdyby
 * je komponenta brala z `obdobi.ts`, stáhl by se s nimi do prohlížeče celý
 * zod (~30 kB). Proč pražský čas: viz `obdobi.ts`.
 */

export const PRAZSKY_CAS = "Europe/Prague";

export const DEN = 86_400_000;

/** Posun pražského pásma vůči UTC v minutách pro daný okamžik. */
export function posunPrahy(okamzik: Date): number {
  const casti = new Intl.DateTimeFormat("en-US", {
    timeZone: PRAZSKY_CAS,
    timeZoneName: "longOffset",
  }).formatToParts(okamzik);

  const text = casti.find((cast) => cast.type === "timeZoneName")?.value ?? "GMT+00:00";
  const shoda = /GMT([+-])(\d{2}):(\d{2})/.exec(text);
  if (!shoda) return 0;

  const minuty = Number(shoda[2]) * 60 + Number(shoda[3]);
  return shoda[1] === "-" ? -minuty : minuty;
}

/**
 * Okamžik, kdy v Praze začíná daný den.
 *
 * Posun se dvakrát ročně mění, takže se dopočítá ještě jednou nad prvním
 * výsledkem — jinak by u přechodu na letní čas vyšla hodina vedle.
 */
export function zacatekDne(rok: number, mesic: number, den: number): Date {
  const odhad = Date.UTC(rok, mesic - 1, den);
  const prvni = odhad - posunPrahy(new Date(odhad)) * 60_000;
  return new Date(odhad - posunPrahy(new Date(prvni)) * 60_000);
}

/** Rozloží okamžik na kalendářní den v Praze. */
export function denVPraze(hodnota: Date): { rok: number; mesic: number; den: number } {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAZSKY_CAS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(hodnota);

  const [rok, mesic, den] = text.split("-").map(Number);
  return { rok, mesic, den };
}

/** Dnešní datum tak, jak ho vidí člověk v Praze. */
export function dnesVPraze(): { rok: number; mesic: number; den: number } {
  return denVPraze(new Date());
}

/** `RRRR-MM-DD` v pražském čase. Klíč pro sčítání po dnech i popisek do adresy. */
export function jakoDen(hodnota: Date): string {
  const { rok, mesic, den } = denVPraze(hodnota);
  return `${rok}-${String(mesic).padStart(2, "0")}-${String(den).padStart(2, "0")}`;
}

/**
 * Posune začátek dne o daný počet dnů.
 *
 * Počítá se přes poledne, ať to přežije přechod na letní čas — v den,
 * kdy má jen 23 hodin, by prosté přičtení 24 hodin skočilo o den dál.
 */
export function posunDne(zaklad: Date, dnu: number): Date {
  const { rok, mesic, den } = denVPraze(new Date(zaklad.getTime() + dnu * DEN + DEN / 2));
  return zacatekDne(rok, mesic, den);
}
