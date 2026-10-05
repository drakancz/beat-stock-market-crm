import type { BadgeKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

/**
 * Odznaky klienta (krok 3C, Jakub 4. 10. 2026) — **za vzdělávání
 * a aktivitu, nikdy za objem obchodů** (security_warnings.md, pravidlo 9).
 *
 * - první hotová lekce, polovina kurzu, dokončený kurz (každý kurz zvlášť),
 * - aktivita 4 týdny po sobě (klient otevřel klientskou část),
 * - první a pátý webinář (účast zapisuje administrátor).
 *
 * **Odznak se nikdy neodebírá** — kdo lekci odškrtne zpět, o odznak
 * nepřijde. Udělování nesmí shodit akci, která ho spustila: funkce tu nic
 * nevyhazují, do logu jde jen druh chyby.
 */

export const POPIS_ODZNAKU: Record<BadgeKind, { nazev: string; popis: string }> = {
  PRVNI_LEKCE: { nazev: "První krok", popis: "Dokončili jste první lekci." },
  PULKA_KURZU: { nazev: "V půlce", popis: "Máte hotovou polovinu kurzu." },
  KURZ_DOKONCEN: { nazev: "Kurz dokončen", popis: "Prošli jste všechny lekce kurzu." },
  AKTIVNI_4_TYDNY: { nazev: "Vytrvalost", popis: "Čtyři týdny po sobě v klientské části." },
  PRVNI_WEBINAR: { nazev: "Na živo", popis: "Zúčastnili jste se prvního webináře." },
  PET_WEBINARU: { nazev: "Pravidelný host", popis: "Zúčastnili jste se pěti webinářů." },
};

function zalogujChybu(chyba: unknown) {
  console.error(
    "Odznak se nepodařilo udělit:",
    chyba instanceof Error ? chyba.name : "neznámá chyba",
  );
}

async function udel(clientId: string, kind: BadgeKind, refId = ""): Promise<void> {
  await db.clientBadge.createMany({ data: [{ clientId, kind, refId }], skipDuplicates: true });
}

/** Po odškrtnutí lekce: první lekce, polovina a konec kurzu. */
export async function udelOdznakyZaLekce(clientId: string, courseId: string): Promise<void> {
  try {
    const lekce = await db.courseLesson.findMany({
      where: { courseId, deletedAt: null },
      select: { hotovo: { where: { clientId }, select: { id: true } } },
    });
    const celkem = lekce.length;
    const hotovo = lekce.filter((l) => l.hotovo.length > 0).length;
    if (hotovo === 0) return;

    await udel(clientId, "PRVNI_LEKCE");
    if (celkem > 0 && hotovo * 2 >= celkem) await udel(clientId, "PULKA_KURZU", courseId);
    if (celkem > 0 && hotovo === celkem) await udel(clientId, "KURZ_DOKONCEN", courseId);
  } catch (chyba) {
    zalogujChybu(chyba);
  }
}

/** Po zápisu účasti: první a pátý webinář. */
export async function udelOdznakyZaWebinare(clientId: string): Promise<void> {
  try {
    const ucasti = await db.webinarAttendance.count({
      where: { clientId, webinar: { deletedAt: null } },
    });
    if (ucasti >= 1) await udel(clientId, "PRVNI_WEBINAR");
    if (ucasti >= 5) await udel(clientId, "PET_WEBINARU");
  } catch (chyba) {
    zalogujChybu(chyba);
  }
}

/* ---------- Aktivita po týdnech ---------- */

/** ISO týden (`2026-W40`) okamžiku v pražském čase. */
export function isoTyden(okamzik: Date): string {
  const den = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(okamzik);
  const [rok, mesic, cislo] = den.split("-").map(Number);
  // Počítá se v UTC nad pražským kalendářním dnem — bez letního času.
  const datum = new Date(Date.UTC(rok!, mesic! - 1, cislo!));
  const denTydne = datum.getUTCDay() || 7;
  datum.setUTCDate(datum.getUTCDate() + 4 - denTydne);
  const zacatekRoku = new Date(Date.UTC(datum.getUTCFullYear(), 0, 1));
  const tyden = Math.ceil(((datum.getTime() - zacatekRoku.getTime()) / 86_400_000 + 1) / 7);
  return `${datum.getUTCFullYear()}-W${String(tyden).padStart(2, "0")}`;
}

/**
 * Klient otevřel klientskou část: zapíše se týden (nic víc o návštěvě)
 * a když má čtyři týdny po sobě, dostane odznak. Volá to rám klientské
 * části; zápis je jeden řádek za týden.
 */
export async function zaznamenejAktivitu(clientId: string, ted = new Date()): Promise<void> {
  try {
    const tento = isoTyden(ted);
    await db.clientActiveWeek.createMany({
      data: [{ clientId, week: tento }],
      skipDuplicates: true,
    });

    const posledni = [0, 1, 2, 3].map((tydnu) =>
      isoTyden(new Date(ted.getTime() - tydnu * 7 * 86_400_000)),
    );
    const zapsane = await db.clientActiveWeek.count({
      where: { clientId, week: { in: posledni } },
    });
    if (zapsane === 4) await udel(clientId, "AKTIVNI_4_TYDNY");
  } catch (chyba) {
    zalogujChybu(chyba);
  }
}

/* ---------- Čtení ---------- */

export interface Odznak {
  kind: BadgeKind;
  nazev: string;
  popis: string;
  kurz: string | null;
  kdy: Date;
}

/**
 * Odznaky klienta i s názvem kurzu, ke kterému patří. `clientId` dodává
 * volající — v klientské části z přihlášení, v CRM z karty klienta, kterou
 * volající už ověřil přes viditelnost.
 */
export async function nactiOdznaky(clientId: string): Promise<Odznak[]> {
  const odznaky = await db.clientBadge.findMany({
    where: { clientId },
    orderBy: { awardedAt: "asc" },
    select: { kind: true, refId: true, awardedAt: true },
  });
  const idKurzu = [...new Set(odznaky.map((o) => o.refId).filter(Boolean))];
  const kurzy = idKurzu.length
    ? await db.course.findMany({
        where: { id: { in: idKurzu } },
        select: { id: true, title: true },
      })
    : [];
  const nazevKurzu = new Map(kurzy.map((k) => [k.id, k.title]));

  return odznaky.map((odznak) => ({
    kind: odznak.kind,
    nazev: POPIS_ODZNAKU[odznak.kind].nazev,
    popis: POPIS_ODZNAKU[odznak.kind].popis,
    kurz: odznak.refId ? (nazevKurzu.get(odznak.refId) ?? null) : null,
    kdy: odznak.awardedAt,
  }));
}
