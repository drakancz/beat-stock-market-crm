import { db } from "@/lib/db";

/**
 * Dotazy pro sekci Vzdělávání v CRM (krok 3C). Oprávnění si ověřuje
 * volající obrazovka (`requireViewer()`, úpravy `requireAdmin()`).
 */

/** Kurzy z ceníku, které ještě nemají obsah — nabídka pro nový kurz. */
export async function kurzyBezObsahu(kromeKurzu?: string) {
  return db.product.findMany({
    where: {
      kind: "KURZ",
      deletedAt: null,
      kurzy: { none: { deletedAt: null, ...(kromeKurzu ? { NOT: { id: kromeKurzu } } : {}) } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Datum a čas pro pole `datetime-local`, **v pražském čase** (stejně jako
 * u zápisu hovoru). Počítá se na serveru a do formuláře jde hotový text.
 */
export function casProPole(hodnota: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(hodnota)
    .replace(" ", "T");
}

/** Komu se webinář ukáže — pro výpis v CRM. */
export const POPIS_PUBLIKA = {
  VSICHNI: "všichni klienti s účtem",
  CLENOVE: "jen členové",
  KURZ: "kupci kurzu",
} as const;
