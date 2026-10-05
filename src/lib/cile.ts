import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { dnesVPraze, zacatekDne } from "@/lib/obdobi";
import { viditelneObjednavky } from "@/lib/queries";
import type { Viewer } from "@/lib/session";

/**
 * Cíle tržeb bez DPH (Nastavení → Cíle, Jakub 10. 9. 2026).
 *
 * **Cíl platí i do dalších měsíců, dokud se nezmění:** pro daný měsíc
 * rozhoduje poslední záznam s měsícem nejvýš tím hledaným. Částka 0
 * znamená „od tohoto měsíce bez cíle". Nastavuje je jen administrátor.
 *
 * **Tržby** jsou součet obchodních případů ve fázi Uzavřena podle data
 * uzavření, bez DPH — stejně jako všechna ostatní čísla v systému.
 * Plnění vidí obchodník jen svoje, manažer a administrátor všechno;
 * rozsah hlídá `viditelneObjednavky()` přímo v dotazu.
 */

/** Měsíc ve tvaru `2026-09`. Co přijde z adresy, musí sedět přesně. */
export const TVAR_MESICE = /^\d{4}-(0[1-9]|1[0-2])$/;

const MESICE = [
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
];

/** Dnešní měsíc v Praze. */
export function tentoMesic(): string {
  const dnes = dnesVPraze();
  return `${dnes.rok}-${String(dnes.mesic).padStart(2, "0")}`;
}

export function posunMesic(mesic: string, o: number): string {
  const [rok, cislo] = mesic.split("-").map(Number);
  const index = rok * 12 + (cislo - 1) + o;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** `2026-09` → `září 2026`. */
export function popisMesice(mesic: string): string {
  const [rok, cislo] = mesic.split("-").map(Number);
  return `${MESICE[cislo - 1] ?? cislo} ${rok}`;
}

function hraniceMesice(mesic: string): { od: Date; do: Date } {
  const [rok, cislo] = mesic.split("-").map(Number);
  return {
    od: zacatekDne(rok, cislo, 1),
    do: cislo === 12 ? zacatekDne(rok + 1, 1, 1) : zacatekDne(rok, cislo + 1, 1),
  };
}

export interface PlatnyCil {
  castka: number;
  /** Od kterého měsíce částka platí. */
  odMesice: string;
}

/** Cíle platné v daném měsíci. Klíč `null` je cíl celého týmu. */
export async function platneCile(mesic: string): Promise<Map<string | null, PlatnyCil>> {
  const zaznamy = await db.salesTarget.findMany({
    where: { month: { lte: mesic } },
    orderBy: [{ month: "desc" }, { updatedAt: "desc" }],
    select: { userId: true, month: true, amount: true },
  });

  const cile = new Map<string | null, PlatnyCil>();
  for (const zaznam of zaznamy) {
    if (!cile.has(zaznam.userId)) {
      cile.set(zaznam.userId, { castka: zaznam.amount.toNumber(), odMesice: zaznam.month });
    }
  }
  return cile;
}

/**
 * Cíl k nastavení — od 22. 9. 2026 **jediný, za celou firmu**.
 *
 * Do té doby se nastavoval každému obchodníkovi zvlášť. Klienti se teď
 * nikomu nepřiřazují, takže tržby nejde rozdělit po lidech a cíl dává
 * smysl jen dohromady.
 */
export async function nactiCileProNastaveni(mesic: string) {
  const cile = await platneCile(mesic);
  const cil = cile.get(null);

  return [
    {
      userId: null,
      name: "Celá firma",
      castka: cil?.castka ?? 0,
      odMesice: cil?.odMesice ?? null,
    },
  ];
}

export interface RadekPlneni {
  id: string | null;
  name: string;
  /** Cíl bez DPH. 0 = bez cíle. */
  cil: number;
  trzby: number;
}

/**
 * Plnění cíle za tento měsíc — pro Dashboard.
 *
 * Jeden řádek za celou firmu (Jakub, 22. 9. 2026). Tržby jsou
 * **zaplacené objednávky** podle data platby, bez DPH; dřív to byly
 * případy ve fázi Uzavřena, rozdělené podle toho, komu klient patřil.
 */
export async function nactiPlneniCilu(viewer: Viewer) {
  const mesic = tentoMesic();
  const { od, do: doKdy } = hraniceMesice(mesic);

  const [cile, objednavky] = await Promise.all([
    platneCile(mesic),
    db.order.findMany({
      where: {
        AND: [viditelneObjednavky(viewer), { status: "ZAPLACENO", paidAt: { gte: od, lt: doKdy } }],
      },
      select: {
        items: {
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: { select: { netPrice: true } },
          },
        },
      },
    }),
  ]);

  const trzby = objednavky.reduce(
    (soucet, objednavka) =>
      soucet +
      objednavka.items.reduce(
        (castka, polozka) => castka + polozka.quantity * cenaPolozkyBezDph(polozka),
        0,
      ),
    0,
  );

  const radky: RadekPlneni[] = [
    { id: null, name: "Celá firma", cil: cile.get(null)?.castka ?? 0, trzby },
  ];

  return { mesic, popis: popisMesice(mesic), radky };
}
