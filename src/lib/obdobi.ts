/**
 * Období, za které se počítají čísla na Dashboardu.
 *
 * **Hranice dnů se počítají v pražském čase**, ne v čase stroje. Kontejner
 * běží v UTC, lidé sedí v Praze — bez přepočtu by „dnešek" začínal ve dvě
 * ráno a hovor z jedenácti večer by spadl do jiného dne, než ve kterém
 * proběhl (stejný důvod jako u formátování v `src/lib/format.ts`).
 *
 * Volba žije v adrese (`/dashboard?obdobi=30dni`), takže se dá poslat
 * odkazem a přežije obnovení stránky. **Všechno, co přijde z adresy, je
 * vstup od uživatele** (security_warnings.md, pravidlo 11) — proto se
 * přijme jen předvolba z uzavřeného seznamu a u vlastního rozsahu jen
 * datum ve tvaru `RRRR-MM-DD` v rozumném rozpětí.
 */

import { z } from "zod";

import { DEN, denVPraze, dnesVPraze, jakoDen, posunDne, posunPrahy, zacatekDne } from "@/lib/den";
import { parametr, precti, vyberParam, type Parametry } from "@/lib/parametry";

// Pražské dny žijí v `den.ts` (bez zodu, pro prohlížeč); tady se nabízejí
// dál, ať se nemusí měnit místa, která je berou odsud.
export { dnesVPraze, jakoDen, posunDne, zacatekDne };

/** Nejdelší rozsah, který jde zadat ručně. Delší je překlep, ne dotaz. */
const MAX_DNU = 366 * 5;

/**
 * Okamžik z formulářového pole `datetime-local` (`2026-09-09T14:30`).
 *
 * Prohlížeč pošle čas **bez pásma** — je to čas, který má člověk na
 * hodinách. Bere se proto jako pražský, ne jako čas kontejneru: hovor
 * zapsaný ve 14:30 má být 14:30 i po uložení.
 *
 * Vrací `null` u čehokoli, co není skutečný okamžik v kalendáři —
 * `31. 2.` i nesmyslná hodina propadnou (security_warnings.md, pravidlo 11).
 */
export function prectiOkamzik(hodnota: string): Date | null {
  const shoda = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(hodnota.trim());
  if (!shoda) return null;

  const [, rok, mesic, den, hodina, minuta] = shoda.map(Number);
  if (rok < 2000 || rok > 2100) return null;
  if (mesic < 1 || mesic > 12 || den < 1 || den > 31) return null;
  if (hodina > 23 || minuta > 59) return null;

  const odhad = Date.UTC(rok, mesic - 1, den, hodina, minuta);
  const prvni = odhad - posunPrahy(new Date(odhad)) * 60_000;
  const okamzik = new Date(odhad - posunPrahy(new Date(prvni)) * 60_000);

  // Zahodí den, který v kalendáři není: `31. 2.` po převodu vyjde jako
  // `3. 3.` a sám se sebou se neshodne.
  const zpet = `${rok}-${String(mesic).padStart(2, "0")}-${String(den).padStart(2, "0")}`;
  return jakoDen(okamzik) === zpet ? okamzik : null;
}

export type IdObdobi = "7dni" | "30dni" | "tento-mesic" | "minuly-mesic" | "letos" | "vlastni";

export const PREDVOLBY: { id: IdObdobi; label: string }[] = [
  { id: "7dni", label: "7 dní" },
  { id: "30dni", label: "30 dní" },
  { id: "tento-mesic", label: "Tento měsíc" },
  { id: "minuly-mesic", label: "Minulý měsíc" },
  { id: "letos", label: "Letos" },
  { id: "vlastni", label: "Vlastní rozsah" },
];

/** Výchozí volba, když si člověk nevybral: poslední měsíc. */
export const VYCHOZI_OBDOBI: IdObdobi = "30dni";

export interface Obdobi {
  id: IdObdobi;
  /** Popisek do podnadpisu: `posledních 30 dní`. */
  label: string;
  /** První okamžik období (včetně). Do dotazu jde jako `gte`. */
  od: Date;
  /** První okamžik **po** období. Do dotazu jde jako `lt`. */
  do: Date;
  /** První a poslední den období ve tvaru `RRRR-MM-DD` — pro výpis rozsahu i pro formulář. */
  prvniDen: string;
  posledniDen: string;
  /** Kolik dní období trvá. */
  dnu: number;
  /** Stejně dlouhý úsek těsně před obdobím — proti němu se srovnává. */
  predchoziOd: Date;
  predchoziDo: Date;
  /**
   * Vlastní rozsah z adresy nešel použít a obrazovka spadla na výchozí měsíc.
   *
   * Stránka to musí **říct nahlas**. Tiché přepnutí je horší než chyba —
   * člověk by koukal na jiná čísla, než si vyžádal, a nepoznal to.
   */
  odmitnutyRozsah?: true;
}

function sestav(id: IdObdobi, label: string, od: Date, doKdy: Date): Obdobi {
  const delka = doKdy.getTime() - od.getTime();

  return {
    id,
    label,
    od,
    do: doKdy,
    prvniDen: jakoDen(od),
    posledniDen: jakoDen(posunDne(doKdy, -1)),
    dnu: Math.max(1, Math.round(delka / DEN)),
    // Stejně dlouhý úsek těsně před obdobím. Srovnávat posledních 30 dní
    // proti celému minulému měsíci by dalo čísla, která spolu nesouvisí.
    predchoziOd: new Date(od.getTime() - delka),
    predchoziDo: od,
  };
}

/**
 * Přijme datum jen ve tvaru `RRRR-MM-DD` a jen jako skutečný den v kalendáři.
 *
 * Vrací začátek toho dne v pražském čase. Používá to výběr období
 * na Dashboardu i filtr dat nad hovory.
 */
export const denSchema = z
  .string()
  // Tvar se kontroluje až tady, ne přes `.regex()`: zod po nesplněné
  // kontrole pokračuje dalšími a výpočet nad „zitra" by vyhodil výjimku
  // (a tu `.catch()` neodchytí — obrazovka by spadla).
  .refine((hodnota) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hodnota)) return false;
    const [rok, mesic, den] = hodnota.split("-").map(Number);
    if (rok < 2000 || rok > 2100 || mesic < 1 || mesic > 12 || den < 1 || den > 31) return false;
    // Zahodí 2026-02-31 a spol. — po převodu by z toho vyšel jiný den.
    return jakoDen(zacatekDne(rok, mesic, den)) === hodnota;
  })
  .transform((hodnota) => {
    const [rok, mesic, den] = hodnota.split("-").map(Number);
    return zacatekDne(rok, mesic, den);
  });

export function prectiDen(hodnota: string | undefined): Date | null {
  const vysledek = denSchema.safeParse(hodnota);
  return vysledek.success ? vysledek.data : null;
}

/** Den v adrese (`?od=2026-09-01`); co není skutečný den, se zahodí. */
export const denParam = parametr(denSchema, undefined);

/**
 * Přečte období z adresy. Co nesedí, se zahodí a padne to na výchozích
 * 30 dní — rozbitý odkaz nesmí obrazovku shodit.
 */
export function prectiObdobi(parametry: Parametry): Obdobi {
  const dnes = dnesVPraze();
  const dnesek = zacatekDne(dnes.rok, dnes.mesic, dnes.den);
  // Období končí až zítřejší půlnocí, aby do něj patřil celý dnešek.
  const zitra = posunDne(dnesek, 1);

  const mesic30 = () => sestav("30dni", "posledních 30 dní", posunDne(dnesek, -29), zitra);

  const vstup = precti(
    z.object({
      obdobi: vyberParam(PREDVOLBY.map((polozka) => polozka.id)),
      od: denParam,
      do: denParam,
    }),
    parametry,
  );
  const id = vstup.obdobi ?? VYCHOZI_OBDOBI;

  switch (id) {
    case "vlastni": {
      const od = vstup.od;
      const doKdy = vstup.do;

      if (od && doKdy && od.getTime() <= doKdy.getTime()) {
        const konec = posunDne(doKdy, 1);
        if (Math.round((konec.getTime() - od.getTime()) / DEN) <= MAX_DNU) {
          return sestav("vlastni", "vybrané období", od, konec);
        }
      }

      // Nepoužitelný rozsah — obrazovka ukáže výchozí měsíc, ale řekne to.
      // Sem spadne i den, který v kalendáři není: `31. 2.` po převodu vyjde
      // jako `3. 3.`, neshodne se sám se sebou a neprojde.
      return { ...mesic30(), odmitnutyRozsah: true };
    }
    case "7dni":
      return sestav("7dni", "posledních 7 dní", posunDne(dnesek, -6), zitra);
    case "tento-mesic":
      return sestav("tento-mesic", "tento měsíc", zacatekDne(dnes.rok, dnes.mesic, 1), zitra);
    case "minuly-mesic": {
      const rok = dnes.mesic === 1 ? dnes.rok - 1 : dnes.rok;
      const mesic = dnes.mesic === 1 ? 12 : dnes.mesic - 1;
      return sestav(
        "minuly-mesic",
        "minulý měsíc",
        zacatekDne(rok, mesic, 1),
        zacatekDne(dnes.rok, dnes.mesic, 1),
      );
    }
    case "letos":
      return sestav("letos", "letošní rok", zacatekDne(dnes.rok, 1, 1), zitra);
    default:
      return mesic30();
  }
}

/** Po čem se v grafu vývoje sčítá: krátké období po dnech, dlouhé po týdnech či měsících. */
export type Krok = "den" | "tyden" | "mesic";

export function krokProObdobi(dnu: number): Krok {
  if (dnu <= 45) return "den";
  if (dnu <= 370) return "tyden";
  return "mesic";
}

/**
 * Do kterého sloupce grafu okamžik patří.
 *
 * Vrací začátek dne, pondělí daného týdne, nebo první den měsíce —
 * vždycky v pražském čase, ať sloupce sedí na dny tak, jak je lidé vidí.
 */
export function zacatekKroku(hodnota: Date, krok: Krok): Date {
  const { rok, mesic, den } = denVPraze(hodnota);

  if (krok === "mesic") return zacatekDne(rok, mesic, 1);
  if (krok === "den") return zacatekDne(rok, mesic, den);

  // Týden začíná pondělím. `getUTCDay()` nad polednem dá správný den
  // i pro pražské pásmo, protože poledne nikdy nepřeteče do sousedního dne.
  const poledne = new Date(zacatekDne(rok, mesic, den).getTime() + DEN / 2);
  const odPondeli = (poledne.getUTCDay() + 6) % 7;
  return posunDne(zacatekDne(rok, mesic, den), -odPondeli);
}

/** Všechny sloupce grafu od začátku do konce období, i ty prázdné. */
export function krokyObdobi(obdobi: Obdobi, krok: Krok): Date[] {
  const kroky: Date[] = [];
  let bezici = zacatekKroku(obdobi.od, krok);

  while (bezici.getTime() < obdobi.do.getTime() && kroky.length < 600) {
    kroky.push(bezici);

    if (krok === "den") bezici = posunDne(bezici, 1);
    else if (krok === "tyden") bezici = posunDne(bezici, 7);
    else {
      const { rok, mesic } = denVPraze(bezici);
      bezici = mesic === 12 ? zacatekDne(rok + 1, 1, 1) : zacatekDne(rok, mesic + 1, 1);
    }
  }

  return kroky;
}

const KRATKE_MESICE = [
  "led",
  "úno",
  "bře",
  "dub",
  "kvě",
  "čvn",
  "čvc",
  "srp",
  "zář",
  "říj",
  "lis",
  "pro",
];

/** Popisek sloupce na ose grafu. U dnů a týdnů `27. 8.`, u měsíců `srp 2026`. */
export function popisekKroku(klic: string, krok: Krok): string {
  const [rok, mesic, den] = klic.split("-").map(Number);
  if (krok === "mesic") return `${KRATKE_MESICE[mesic - 1] ?? mesic} ${rok}`;
  return `${den}. ${mesic}.`;
}
