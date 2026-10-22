import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { dnesniZacatek } from "@/lib/platnost";

/**
 * Aktivita klienta a „platí, ale nechodí“ (Fáze 5B, Jakub 15. 10. 2026).
 *
 * Pravidla, která Jakub vybral:
 *
 * 1. **Vidí každý přihlášený** — kartu i značku v seznamu. Jen se
 *    zobrazuje, nic se tím nemění.
 * 2. **„Platí“ = běžící členství**: aspoň jeden produkt s platností, která
 *    sahá do dneška. Kupec kurzu (doživotní přístup) mezi ně nepatří.
 * 3. **„Nechodí“ = poslední návštěva klientské části i poslední zaplacení
 *    jsou starší než N dní** (Nastavení → Prodloužení, výchozí 21).
 *    Čerstvý člen tak má čas se rozkoukat. Kdo nemá účet nebo nikdy
 *    nepřišel, nechodí taky.
 * 4. **Zatím jen značka a filtr** — úkoly a zprávy až s pravidly 5D.
 *
 * O návštěvě se ukládá **jen poslední čas** (`client_accounts.lastSeenAt`),
 * žádná historie.
 */

/** Jak často se smí zapsat poslední návštěva — ať každé kliknutí nepíše do databáze. */
const ZAPIS_NEJVYS_ZA_MS = 10 * 60_000;

/**
 * Zapíše, že klient právě otevřel klientskou část. Volá to rám klientské
 * části (přes `zaznamenejAktivitu()`); zápis je podmíněný, takže se nic
 * nepřepisuje častěji než jednou za 10 minut.
 */
export async function zapisNavstevu(clientId: string, ted = new Date()): Promise<void> {
  await db.clientAccount.updateMany({
    where: {
      clientId,
      OR: [
        { lastSeenAt: null },
        { lastSeenAt: { lt: new Date(ted.getTime() - ZAPIS_NEJVYS_ZA_MS) } },
      ],
    },
    data: { lastSeenAt: ted },
  });
}

/** Od kdy se počítá „nedávno“: aktivita před tímhle okamžikem je stará. */
export function hraniceNechodi(dni: number, ted = new Date()): Date {
  return new Date(ted.getTime() - dni * 86_400_000);
}

/** Podmínka do dotazu na klienty: platí, ale nechodí (pravidla 2 a 3). */
export function podminkaNechodi(hranice: Date): Prisma.ClientWhereInput {
  return {
    AND: [
      { platnosti: { some: { validUntil: { gte: dnesniZacatek() } } } },
      // Bez účtu, s účtem bez návštěvy, nebo se starou návštěvou. Ne přes
      // `NOT … gte`: prázdná návštěva by v SQL dala „nevím“ a klient s účtem,
      // který ještě nepřišel, by z filtru vypadl (opraveno 18. 10. 2026).
      {
        OR: [
          { ucet: { is: null } },
          { ucet: { is: { lastSeenAt: null } } },
          { ucet: { is: { lastSeenAt: { lt: hranice } } } },
        ],
      },
      { orders: { none: { status: "ZAPLACENO", deletedAt: null, paidAt: { gte: hranice } } } },
    ],
  };
}

/** Totéž pravidlo nad načtenými údaji — pro značku v seznamu a na kartě. */
export function nechodi(
  klient: {
    beziClenstvi: boolean;
    posledniNavsteva: Date | null;
    posledniPlatba: Date | null;
  },
  hranice: Date,
): boolean {
  if (!klient.beziClenstvi) return false;
  if (klient.posledniNavsteva && klient.posledniNavsteva >= hranice) return false;
  if (klient.posledniPlatba && klient.posledniPlatba >= hranice) return false;
  return true;
}

/** Hranice podle Nastavení — jedna na vykreslení stránky. */
export async function aktualniHraniceNechodi(): Promise<{ dni: number; hranice: Date }> {
  const { inactiveMemberDays } = await nactiNastaveni();
  return { dni: inactiveMemberDays, hranice: hraniceNechodi(inactiveMemberDays) };
}
