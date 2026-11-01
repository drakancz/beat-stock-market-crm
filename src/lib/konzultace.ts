import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu, type Transakce } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { zapisDoKalendare } from "@/lib/kalendar";
import { upozorniKlienta } from "@/lib/klient/oznameni";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import { dataRezervace, posliWebhook } from "@/lib/webhooky";

/**
 * Rezervace konzultace (Fáze 5B, Jakub 19. 10. 2026).
 *
 * | Kdo           | Smí                                                              |
 * | ------------- | ---------------------------------------------------------------- |
 * | administrátor | vypsat a smazat termín, zrušit rezervaci klienta                 |
 * | uživatel      | vidět termíny a rezervace (Konzultace, karta klienta)            |
 * | klient        | rezervovat, **jen když má zaplacenou konzultaci**; zrušit nebo   |
 * |               | přeložit **nejpozději 24 hodin předem**                          |
 *
 * **Jedna zaplacená konzultace = jedna rezervace.** Zaplaceno = součet kusů
 * produktů druhu Konzultace v zaplacených, nesmazaných objednávkách klienta;
 * využito = platné (nezrušené) rezervace, i proběhlé. Zrušená rezervace
 * konzultaci vrací.
 *
 * **Termín zabere jen jeden klient** — rezervace se na termín zapíše
 * podmíněným zápisem (`activeBookingId` jen když je prázdné). Souběžné
 * rezervace téhož klienta hlídá zámek řádku klienta (`FOR UPDATE`), takže
 * dvě kliknutí naráz nespotřebují víc, než má zaplaceno.
 *
 * **Úvodní konzultace zdarma** (6H, Jakub 27. 10. 2026) si návštěvník
 * Landing Page zarezervuje bez platby — jen v ukázkovém režimu, adresa
 * `POST /api/konzultace/rezervace`. Rezervace má `free`, do využitých se
 * nepočítá a klient má nejvýš jednu nezrušenou.
 */

/** Klient zruší nebo přeloží sám nejpozději tolik hodin před začátkem. */
export const ZRUSIT_PREDEM_HODIN = 24;
const ZRUSIT_PREDEM_MS = ZRUSIT_PREDEM_HODIN * 60 * 60_000;

/** Kolik týdnů za sebou jde termín vypsat najednou („každé úterý“). */
export const NEJVIC_OPAKOVANI = 12;

export class ChybaKonzultace extends Error {}

/* ---------- Kolik konzultací klient má ---------- */

export interface StavKonzultaci {
  zaplaceno: number;
  vyuzito: number;
  zbyva: number;
}

export async function stavKonzultaci(
  clientId: string,
  klient: Transakce | typeof db = db,
): Promise<StavKonzultaci> {
  // Po sobě, ne přes Promise.all: volá se i s transakcí (viz platnost.ts).
  const polozky = await klient.orderItem.aggregate({
    where: {
      product: { kind: "KONZULTACE" },
      order: { clientId, deletedAt: null, status: "ZAPLACENO" },
    },
    _sum: { quantity: true },
  });
  // Úvodní zdarma z webu ze zaplacených neubírá.
  const vyuzito = await klient.consultationBooking.count({
    where: { clientId, cancelledAt: null, free: false },
  });
  const zaplaceno = polozky._sum.quantity ?? 0;
  return { zaplaceno, vyuzito, zbyva: Math.max(0, zaplaceno - vyuzito) };
}

export interface KonzultaceKlienta extends StavKonzultaci {
  /** Začátek nejbližší nadcházející rezervace, nebo `null`. */
  pristi: Date | null;
  /** Má nezrušenou úvodní konzultaci zdarma z Landing Page (6H). */
  uvodni: boolean;
}

/**
 * Souhrn pro Přehled klienta a kartu klienta v CRM: kolik zaplaceno,
 * využito, zbývá a kdy je příští rezervace.
 */
export async function nactiKonzultaceKlienta(
  clientId: string,
  ted = new Date(),
): Promise<KonzultaceKlienta> {
  const [stav, pristi, uvodni] = await Promise.all([
    stavKonzultaci(clientId),
    db.consultationBooking.findFirst({
      where: { clientId, cancelledAt: null, slot: { deletedAt: null, startsAt: { gt: ted } } },
      orderBy: { slot: { startsAt: "asc" } },
      select: { slot: { select: { startsAt: true } } },
    }),
    db.consultationBooking.count({ where: { clientId, cancelledAt: null, free: true } }),
  ]);
  return { ...stav, pristi: pristi?.slot.startsAt ?? null, uvodni: uvodni > 0 };
}

/** Termín, který si klient může vzít: budoucí, nesmazaný, volný. */
export function volneTerminy(ted = new Date()): Prisma.ConsultationSlotWhereInput {
  return { deletedAt: null, activeBookingId: null, startsAt: { gt: ted } };
}

/** Smí klient rezervaci ještě zrušit nebo přeložit sám? */
export function lzeZrusitKlientem(zacatek: Date, ted = new Date()): boolean {
  return zacatek.getTime() - ted.getTime() >= ZRUSIT_PREDEM_MS;
}

/* ---------- Rezervace, zrušení, přeložení ---------- */

const RADEK_REZERVACE = {
  id: true,
  clientId: true,
  free: true,
  cancelledAt: true,
  taskId: true,
  slot: { select: { id: true, startsAt: true } },
} as const;

/** Zamkne řádek klienta do konce transakce — souběžné rezervace čekají. */
async function zamkniKlienta(tx: Transakce, clientId: string) {
  await tx.$queryRaw`SELECT 1 FROM "clients" WHERE "id" = ${clientId} FOR UPDATE`;
}

/**
 * Zapíše rezervaci uvnitř transakce. Vyhodí `ChybaKonzultace` s textem pro
 * klienta, když nemá volnou konzultaci nebo je termín pryč. `zdarma` =
 * úvodní konzultace z webu: místo zaplacené se hlídá, že jinou nezrušenou
 * úvodní klient nemá.
 */
async function zapisRezervaci(
  tx: Transakce,
  clientId: string,
  slotId: string,
  ted: Date,
  zdarma = false,
): Promise<{ bookingId: string; startsAt: Date }> {
  if (zdarma) {
    const uvodni = await tx.consultationBooking.count({
      where: { clientId, cancelledAt: null, free: true },
    });
    if (uvodni > 0) throw new ChybaKonzultace("Úvodní konzultaci už máte zarezervovanou.");
  } else {
    const stav = await stavKonzultaci(clientId, tx);
    if (stav.zbyva < 1) {
      throw new ChybaKonzultace("Nemáte žádnou zaplacenou konzultaci k rezervaci.");
    }
  }

  const termin = await tx.consultationSlot.findFirst({
    where: { id: slotId, deletedAt: null },
    select: {
      id: true,
      startsAt: true,
      host: { select: { id: true, active: true, deletedAt: true } },
    },
  });
  if (!termin || termin.startsAt <= ted) throw new ChybaKonzultace("Takový termín není volný.");

  const rezervace = await tx.consultationBooking.create({
    data: { slotId: termin.id, clientId, free: zdarma },
    select: { id: true },
  });

  // Zabrat termín jen tehdy, když ho mezitím nevzal někdo jiný.
  const zabrano = await tx.consultationSlot.updateMany({
    where: { id: termin.id, activeBookingId: null, deletedAt: null },
    data: { activeBookingId: rezervace.id },
  });
  if (zabrano.count === 0) {
    throw new ChybaKonzultace("Termín si mezitím zarezervoval někdo jiný. Vyberte prosím jiný.");
  }

  // Úkol pro toho, kdo konzultaci vede — termín je den konzultace.
  const vede = termin.host?.active && !termin.host.deletedAt ? termin.host.id : null;
  if (vede) {
    const ukol = await tx.task.create({
      data: {
        clientId,
        userId: vede,
        title: `Konzultace ${formatDatumCas(termin.startsAt)}`,
        dueAt: posunDne(termin.startsAt, 0),
      },
      select: { id: true, title: true },
    });
    await tx.consultationBooking.update({
      where: { id: rezervace.id },
      data: { taskId: ukol.id },
    });
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "tasks",
      entityId: ukol.id,
      action: "ukol.zalozen",
      after: { title: ukol.title, komu: vede, automaticky: true },
    });
  }

  return { bookingId: rezervace.id, startsAt: termin.startsAt };
}

/** Zruší rezervaci uvnitř transakce: uvolní termín a smaže úkol. */
async function zapisZruseni(
  tx: Transakce,
  rezervace: { id: string; taskId: string | null; slot: { id: string } },
  kdo: { klient: true } | { userId: string },
  ted: Date,
) {
  const zruseno = await tx.consultationBooking.updateMany({
    where: { id: rezervace.id, cancelledAt: null },
    data: {
      cancelledAt: ted,
      cancelledByClient: "klient" in kdo,
      cancelledById: "userId" in kdo ? kdo.userId : null,
    },
  });
  if (zruseno.count === 0) throw new ChybaKonzultace("Rezervace už je zrušená.");

  await tx.consultationSlot.updateMany({
    where: { id: rezervace.slot.id, activeBookingId: rezervace.id },
    data: { activeBookingId: null },
  });

  if (rezervace.taskId) {
    const ukol = await tx.task.updateMany({
      where: { id: rezervace.taskId, deletedAt: null, doneAt: null },
      data: { deletedAt: ted },
    });
    if (ukol.count > 0) {
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "tasks",
        entityId: rezervace.taskId,
        action: "ukol.smazan",
        before: { duvod: "konzultace zrušena" },
      });
    }
  }
}

/** Převede chybu databáze ze souběhu na srozumitelnou hlášku. */
function srozumitelne(chyba: unknown): never {
  if (chyba instanceof ChybaKonzultace) throw chyba;
  // Jedinečnost `activeBookingId` — souběh, který podmíněný zápis nestihl.
  if (chyba && typeof chyba === "object" && "code" in chyba && chyba.code === "P2002") {
    throw new ChybaKonzultace("Termín si mezitím zarezervoval někdo jiný. Vyberte prosím jiný.");
  }
  throw chyba;
}

/**
 * Klienti, kteří mají aspoň jednu volnou zaplacenou konzultaci — nabídka
 * pro rezervaci za klienta v CRM (Jakub, 19. 10. 2026). Bez Smazaných
 * a sloučených karet.
 */
export async function klientiSVolnouKonzultaci(): Promise<{ id: string; name: string }[]> {
  return db.$queryRaw<{ id: string; name: string }[]>`
    SELECT c."id", c."name"
      FROM "clients" c
      JOIN "orders" o ON o."clientId" = c."id" AND o."deletedAt" IS NULL AND o."status" = 'ZAPLACENO'
      JOIN "order_items" i ON i."orderId" = o."id"
      JOIN "products" p ON p."id" = i."productId" AND p."kind" = 'KONZULTACE'
     WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
     GROUP BY c."id", c."name"
    HAVING SUM(i."quantity") > (
      SELECT count(*) FROM "consultation_bookings" b
       WHERE b."clientId" = c."id" AND b."cancelledAt" IS NULL AND b."free" = false
    )
     ORDER BY c."name"`;
}

/**
 * Rezervace volného termínu. Rezervuje buď klient sám (`userId` prázdné),
 * nebo za něj kdokoli z týmu (Jakub, 19. 10. 2026) — pravidlo zaplacené
 * konzultace platí stejně.
 */
export async function zarezervujKonzultaci(
  clientId: string,
  slotId: string,
  userId: string | null = null,
): Promise<Date> {
  const ted = new Date();
  try {
    const vysledek = await db.$transaction(async (tx) => {
      await zamkniKlienta(tx, clientId);
      const zapsano = await zapisRezervaci(tx, clientId, slotId, ted);
      await zapisDoAuditu(tx, {
        userId,
        entity: "clients",
        entityId: clientId,
        action: "konzultace.rezervovana",
        after: { termin: zapsano.startsAt.toISOString() },
      });
      return zapsano;
    });
    await potvrdKlientovi(clientId, vysledek.startsAt, "rezervace");
    posliWebhook("konzultace.rezervovana", () => dataRezervace(vysledek.bookingId));
    zapisDoKalendare(vysledek.bookingId);
    return vysledek.startsAt;
  } catch (chyba) {
    srozumitelne(chyba);
  }
}

/**
 * Úvodní konzultace zdarma z Landing Page (6H, Jakub 27. 10. 2026) — volá
 * jen `POST /api/konzultace/rezervace`, a to jen v ukázkovém režimu.
 * Audit bez „kdo“ se značkou zdroje; klient dostane potvrzení jako jindy
 * (v ukázce nic neodejde).
 */
export async function zarezervujUvodniKonzultaci(
  clientId: string,
  slotId: string,
): Promise<{ bookingId: string; startsAt: Date }> {
  const ted = new Date();
  try {
    const vysledek = await db.$transaction(async (tx) => {
      await zamkniKlienta(tx, clientId);
      const zapsano = await zapisRezervaci(tx, clientId, slotId, ted, true);
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "clients",
        entityId: clientId,
        action: "konzultace.rezervovana",
        after: { termin: zapsano.startsAt.toISOString(), zdarma: true, zdroj: "landing-page" },
      });
      return zapsano;
    });
    await potvrdKlientovi(clientId, vysledek.startsAt, "rezervace");
    posliWebhook("konzultace.rezervovana", () => dataRezervace(vysledek.bookingId));
    zapisDoKalendare(vysledek.bookingId);
    return vysledek;
  } catch (chyba) {
    srozumitelne(chyba);
  }
}

/** Najde platnou rezervaci klienta (jen jeho vlastní). */
async function rezervaceKlienta(tx: Transakce, clientId: string, bookingId: string) {
  const rezervace = await tx.consultationBooking.findFirst({
    where: { id: bookingId, clientId, cancelledAt: null },
    select: RADEK_REZERVACE,
  });
  if (!rezervace) throw new ChybaKonzultace("Taková rezervace neexistuje.");
  return rezervace;
}

/** Klient zruší svou rezervaci — jen do 24 hodin před začátkem. */
export async function zrusKonzultaciKlientem(clientId: string, bookingId: string): Promise<Date> {
  const ted = new Date();
  try {
    const zacatek = await db.$transaction(async (tx) => {
      await zamkniKlienta(tx, clientId);
      const rezervace = await rezervaceKlienta(tx, clientId, bookingId);
      if (!lzeZrusitKlientem(rezervace.slot.startsAt, ted)) {
        throw new ChybaKonzultace(
          `Méně než ${ZRUSIT_PREDEM_HODIN} hodin před začátkem už jde konzultaci zrušit jen s námi — napište nám prosím.`,
        );
      }
      await zapisZruseni(tx, rezervace, { klient: true }, ted);
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "clients",
        entityId: clientId,
        action: "konzultace.zrusena",
        before: { termin: rezervace.slot.startsAt.toISOString() },
      });
      return rezervace.slot.startsAt;
    });
    posliWebhook("konzultace.zrusena", () => dataRezervace(bookingId));
    zapisDoKalendare(bookingId);
    return zacatek;
  } catch (chyba) {
    srozumitelne(chyba);
  }
}

/** Klient přeloží rezervaci na jiný volný termín — obojí najednou, nebo nic. */
export async function prelozKonzultaci(
  clientId: string,
  bookingId: string,
  slotId: string,
): Promise<Date> {
  const ted = new Date();
  try {
    const vysledek = await db.$transaction(async (tx) => {
      await zamkniKlienta(tx, clientId);
      const rezervace = await rezervaceKlienta(tx, clientId, bookingId);
      if (rezervace.slot.id === slotId) throw new ChybaKonzultace("Tenhle termín už máte.");
      if (!lzeZrusitKlientem(rezervace.slot.startsAt, ted)) {
        throw new ChybaKonzultace(
          `Méně než ${ZRUSIT_PREDEM_HODIN} hodin před začátkem už jde konzultaci přeložit jen s námi — napište nám prosím.`,
        );
      }
      await zapisZruseni(tx, rezervace, { klient: true }, ted);
      // Úvodní zdarma zůstane úvodní i na novém termínu.
      const novy = await zapisRezervaci(tx, clientId, slotId, ted, rezervace.free);
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "clients",
        entityId: clientId,
        action: "konzultace.prelozena",
        before: { termin: rezervace.slot.startsAt.toISOString() },
        after: { termin: novy.startsAt.toISOString() },
      });
      return { ...novy, puvodni: rezervace.slot.startsAt };
    });
    await potvrdKlientovi(clientId, vysledek.startsAt, "prelozeni");
    posliWebhook("konzultace.prelozena", () => dataRezervace(vysledek.bookingId, vysledek.puvodni));
    zapisDoKalendare(bookingId, vysledek.bookingId);
    return vysledek.startsAt;
  } catch (chyba) {
    srozumitelne(chyba);
  }
}

/**
 * Administrátor zruší rezervaci klienta — kdykoli, i méně než 24 hodin
 * předem. Klient dostane upozornění a konzultace se mu vrátí.
 */
export async function zrusKonzultaciAdminem(
  userId: string,
  bookingId: string,
): Promise<{ clientId: string; jmeno: string; startsAt: Date }> {
  const ted = new Date();
  try {
    const vysledek = await db.$transaction(async (tx) => {
      const rezervace = await tx.consultationBooking.findFirst({
        where: { id: bookingId, cancelledAt: null },
        select: { ...RADEK_REZERVACE, client: { select: { name: true } } },
      });
      if (!rezervace) throw new ChybaKonzultace("Taková rezervace neexistuje.");
      await zamkniKlienta(tx, rezervace.clientId);
      await zapisZruseni(tx, rezervace, { userId }, ted);
      await zapisDoAuditu(tx, {
        userId,
        entity: "clients",
        entityId: rezervace.clientId,
        action: "konzultace.zrusena",
        before: { termin: rezervace.slot.startsAt.toISOString(), klient: rezervace.client.name },
      });
      return {
        clientId: rezervace.clientId,
        jmeno: rezervace.client.name,
        startsAt: rezervace.slot.startsAt,
      };
    });
    await potvrdKlientovi(vysledek.clientId, vysledek.startsAt, "zruseni");
    posliWebhook("konzultace.zrusena", () => dataRezervace(bookingId));
    zapisDoKalendare(bookingId);
    return vysledek;
  } catch (chyba) {
    srozumitelne(chyba);
  }
}

/* ---------- Upozornění klientovi ---------- */

/**
 * Potvrzení klientovi — oznámení, jinak e-mail (`upozorniKlienta()`). Text
 * oznámení je bez názvu produktu a částky, jen čas (zamčená obrazovka).
 * Upozornění nesmí shodit to, co se právě zapsalo.
 */
async function potvrdKlientovi(
  clientId: string,
  startsAt: Date,
  druh: "rezervace" | "prelozeni" | "zruseni",
) {
  const kdy = formatDatumCas(startsAt);
  const texty = {
    rezervace: { nadpis: "Konzultace je zarezervovaná", text: `Těšíme se na vás ${kdy}.` },
    prelozeni: { nadpis: "Konzultace je přeložená", text: `Nový termín: ${kdy}.` },
    zruseni: {
      nadpis: "Konzultace je zrušená",
      text: `Termín ${kdy} jsme museli zrušit. Konzultace vám zůstává — vyberte si prosím jiný termín.`,
    },
  }[druh];
  await upozorniKlienta(clientId, {
    ...texty,
    odkaz: "/ucet/konzultace",
    znacka: "konzultace",
    odstavceEmailu: [`Dobrý den, ${texty.text.charAt(0).toLowerCase()}${texty.text.slice(1)}`],
  });
}

/** Pražské datum `RRRR-MM-DD` okamžiku. */
function denVPraze(okamzik: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(okamzik);
}

/**
 * Připomínka den předem — spouští ji ranní plánovač (`POST /api/planovac`).
 * Každá rezervace jen jednou: zabere se podmíněným zápisem `remindedAt`
 * dřív, než připomínka odejde. Rezervace na dnešek (zarezervovaná včera
 * večer po plánovači) připomínku nedostane — klient o ní ví.
 */
export async function pripomenKonzultace(ted = new Date()): Promise<number> {
  const dnes = dnesniZacatek();
  const zitra = denVPraze(posunDne(dnes, 1));
  let odeslano = 0;

  const rezervace = await db.consultationBooking.findMany({
    where: {
      cancelledAt: null,
      remindedAt: null,
      slot: { deletedAt: null, startsAt: { gt: ted, lt: posunDne(dnes, 2) } },
      client: { deletedAt: null },
    },
    select: { id: true, clientId: true, slot: { select: { startsAt: true, joinUrl: true } } },
  });

  for (const r of rezervace) {
    if (denVPraze(r.slot.startsAt) !== zitra) continue;
    try {
      const zabrano = await db.consultationBooking.updateMany({
        where: { id: r.id, remindedAt: null, cancelledAt: null },
        data: { remindedAt: ted },
      });
      if (zabrano.count === 0) continue;

      const kdy = formatDatumCas(r.slot.startsAt);
      const cas = kdy.split(", ")[1] ?? kdy;
      await upozorniKlienta(r.clientId, {
        nadpis: "Zítra máte konzultaci",
        text: `Začínáme zítra v ${cas}.`,
        odkaz: "/ucet/konzultace",
        znacka: `konzultace-${r.id}`,
        odstavceEmailu: [
          `Dobrý den, připomínáme vaši konzultaci — ${kdy}.`,
          r.slot.joinUrl
            ? `Připojit se můžete tady: ${r.slot.joinUrl}`
            : "Podrobnosti najdete v klientské části v sekci Konzultace.",
        ],
      });
      odeslano += 1;
    } catch (chyba) {
      // Jedna rezervace nesmí zastavit ostatní. Do logu jen druh chyby.
      console.error(
        "Připomínka konzultace selhala:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }
  return odeslano;
}
