import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { posunDne } from "@/lib/obdobi";
import { zacatekDneOkamziku } from "@/lib/platnost";

/**
 * Postupné odemykání lekcí (Fáze 5C, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                         |
 * | ------------- | ----------------------------------------------------------- |
 * | klient        | vidět název zamčené lekce a kdy se otevře; obsah až pak     |
 * | uživatel      | v CRM u lekce vidět pravidlo odemknutí                      |
 * | administrátor | navíc pravidlo nastavit ve formuláři lekce                  |
 *
 * Lekce má tři nepovinné podmínky a **musí platit všechny vyplněné**:
 * N dní po prvním zaplacení kurzu, od data, a po dokončení předchozí
 * lekce. Nic vyplněného = otevřená hned. Dny jsou pražské.
 *
 * **Jediné místo s tímhle pravidlem** — kurz, lekce, Pokračovat i akce
 * (Hotovo, kvíz, hodnocení) se ptají tady. Zamčenou lekci server nevydá.
 */

export const NEJVIC_DNI = 365;

export interface PravidloOdemceni {
  unlockAfterDays: number | null;
  unlockOn: Date | null;
  unlockAfterPrevious: boolean;
}

export const VYBER_PRAVIDLA = {
  unlockAfterDays: true,
  unlockOn: true,
  unlockAfterPrevious: true,
} as const;

/**
 * Okamžik, kdy se lekce otevře podle dnů a data (bez podmínky „po
 * předchozí“), nebo `null`, když na čas nečeká. Používá ho i pravidlo
 * „Odemčená lekce → oznámení“ (5D).
 */
export function okamzikOtevreni(pravidlo: PravidloOdemceni, zaplaceno: Date | null): Date | null {
  const okamziky: Date[] = [];
  if (pravidlo.unlockAfterDays !== null && pravidlo.unlockAfterDays > 0 && zaplaceno) {
    okamziky.push(posunDne(zacatekDneOkamziku(zaplaceno), pravidlo.unlockAfterDays));
  }
  if (pravidlo.unlockOn) okamziky.push(pravidlo.unlockOn);
  return okamziky.sort((a, b) => +b - +a)[0] ?? null;
}

/**
 * Proč je lekce zamčená, nebo `null`, když je otevřená.
 *
 * `zaplaceno` = první zaplacení kurzu; `predchozi` = předchozí lekce
 * v pořadí (`null` u první, ta na předchozí nečeká).
 */
export function procZamcena(
  pravidlo: PravidloOdemceni,
  {
    zaplaceno,
    predchozi,
    ted = new Date(),
  }: {
    zaplaceno: Date | null;
    predchozi: { title: string; hotovo: boolean } | null;
    ted?: Date;
  },
): string | null {
  const otevreni = okamzikOtevreni(pravidlo, zaplaceno);
  const odKdy = otevreni && otevreni > ted ? otevreni : null;

  const cekaNaPredchozi = pravidlo.unlockAfterPrevious && predchozi !== null && !predchozi.hotovo;

  if (!odKdy && !cekaNaPredchozi) return null;
  const casti = [
    odKdy && formatDatum(odKdy),
    cekaNaPredchozi && `po dokončení lekce ${predchozi!.title}`,
  ].filter(Boolean);
  return `Otevře se ${casti.join(" a ")}.`;
}

/** Pravidlo slovy pro CRM, nebo `null` = otevřená hned. */
export function popisPravidla(pravidlo: PravidloOdemceni): string | null {
  const casti = [
    pravidlo.unlockAfterDays ? `${pravidlo.unlockAfterDays} dní po zakoupení` : null,
    pravidlo.unlockOn ? `od ${formatDatum(pravidlo.unlockOn)}` : null,
    pravidlo.unlockAfterPrevious ? "po dokončení předchozí lekce" : null,
  ].filter(Boolean);
  return casti.length > 0 ? `Otevře se ${casti.join(", ")}` : null;
}

/** Kdy klient kurz poprvé zaplatil — od toho se počítají dny. */
export async function prvniZaplaceniKurzu(
  clientId: string,
  productId: string,
): Promise<Date | null> {
  const objednavka = await db.order.findFirst({
    where: {
      clientId,
      status: "ZAPLACENO",
      deletedAt: null,
      paidAt: { not: null },
      items: { some: { productId } },
    },
    orderBy: { paidAt: "asc" },
    select: { paidAt: true },
  });
  return objednavka?.paidAt ?? null;
}
