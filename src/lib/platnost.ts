import { zapisDoAuditu, type Transakce } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { dnesVPraze, jakoDen, posunDne, zacatekDne } from "@/lib/obdobi";

/**
 * Platnost produktů — do kdy klientovi běží členství (Jakub, 24. 9. 2026).
 *
 * Pravidla, která Jakub vybral:
 *
 * 1. **Délka je u produktu v ceníku** v měsících (`products.validityMonths`),
 *    prázdná = produkt nekončí. Při zaplacení se opíše do položky
 *    objednávky, takže pozdější změna v ceníku už zaplacené nepřepíše.
 * 2. **Počítá se od zaplacení** (`orders.paidAt`) a **další zaplacení
 *    navazuje**: kdo prodlouží ještě před koncem, nepřijde o zaplacené dny.
 *    Víc kusů = víc období za sebou.
 * 3. **Ruční úprava konce je jen pro administrátora** — přebije platby
 *    před sebou, na platby po ní se navazuje.
 * 4. **Úkol „zavolat kvůli prodloužení" dostane jeden člověk** z Nastavení
 *    → Prodloužení, ve chvíli, kdy je do konce míň dní, než je tam
 *    nastavené. Dřív ne — Můj den ukazuje všechny nehotové úkoly, takže
 *    by tam visel rok dopředu.
 *
 * **Konec se nikdy nepíše ručně do `validUntil`**, vždy přes
 * `prepocitejPlatnost()`. Volá se všude, kde se mění, co je zaplacené:
 * přepnutí stavu objednávky, smazání a obnovení objednávky, příjem
 * zaplacené objednávky z Landing Page, změna délky v ceníku a ruční úprava.
 *
 * **Kurz platí napořád** (Jakub, 27. 9. 2026): zakoupením kurzu má klient
 * doživotní přístup. **Konzultace je jednorázová** (Jakub, 28. 9. 2026).
 * Ani jeden proto délku nemá (`maPlatnost()` v `types.ts`, hlídá
 * `produkty/actions.ts`), nemá řádek platnosti a nevzniká k němu úkol
 * na prodloužení.
 */

/**
 * Zruší platnost produktu, který se stal kurzem nebo konzultací.
 *
 * Zahodí délku opsanou do zaplacených položek, spočítané konce u klientů
 * a otevřené úkoly na prodloužení, které k nim CRM založilo. Totéž
 * udělaly migrace `kurz_neomezeno` a `konzultace_bez_platnosti`
 * s produkty, které už v ceníku byly.
 */
export async function zrusPlatnostProduktu(tx: Transakce, productId: string): Promise<void> {
  await tx.orderItem.updateMany({ where: { productId }, data: { validityMonths: null } });

  const radky = await tx.productValidity.findMany({
    where: { productId },
    select: { reminderTaskId: true },
  });
  const ukoly = radky.flatMap((radek) => (radek.reminderTaskId ? [radek.reminderTaskId] : []));
  if (ukoly.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: ukoly }, doneAt: null, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  await tx.productValidity.deleteMany({ where: { productId } });
}

/** Začátek dnešního dne v Praze. Platnost „do 24. 9." platí celý ten den. */
export function dnesniZacatek(): Date {
  const { rok, mesic, den } = dnesVPraze();
  return zacatekDne(rok, mesic, den);
}

/** Začátek pražského dne, do kterého okamžik patří. */
export function zacatekDneOkamziku(okamzik: Date): Date {
  const [rok, mesic, den] = jakoDen(okamzik).split("-").map(Number);
  return zacatekDne(rok, mesic, den);
}

/**
 * Přičte kalendářní měsíce ke dni.
 *
 * Den v měsíci zůstává, jen když v cílovém měsíci existuje: 31. 1. +
 * 1 měsíc je 28. (29.) 2., ne 3. 3. — jinak by se konec členství
 * posouval o dny, které klient nezaplatil.
 */
export function pridejMesice(zaklad: Date, mesicu: number): Date {
  const [rok, mesic, den] = jakoDen(zaklad).split("-").map(Number);
  const index = mesic - 1 + mesicu;
  const cilovyRok = rok + Math.floor(index / 12);
  const cilovyMesic = (((index % 12) + 12) % 12) + 1;
  const dnuVMesici = new Date(Date.UTC(cilovyRok, cilovyMesic, 0)).getUTCDate();
  return zacatekDne(cilovyRok, cilovyMesic, Math.min(den, dnuVMesici));
}

/**
 * Opíše délku platnosti z ceníku do položek objednávky (při zaplacení),
 * nebo ji zahodí (při návratu ze Zaplaceno).
 *
 * Opisuje se jen tam, kde položka délku ještě nemá a produkt ji má —
 * produkt bez délky nechá položku prázdnou, takže až ji administrátor
 * zadá, projeví se i u objednávek zaplacených dřív.
 */
export async function opisDelkuPlatnosti(
  tx: Transakce,
  orderId: string,
  zaplaceno: boolean,
): Promise<void> {
  if (!zaplaceno) {
    await tx.orderItem.updateMany({ where: { orderId }, data: { validityMonths: null } });
    return;
  }

  const polozky = await tx.orderItem.findMany({
    where: { orderId, validityMonths: null, product: { validityMonths: { not: null } } },
    select: { id: true, product: { select: { validityMonths: true } } },
  });

  for (const polozka of polozky) {
    await tx.orderItem.update({
      where: { id: polozka.id },
      data: { validityMonths: polozka.product.validityMonths },
    });
  }
}

/** Jedno zaplacení produktu: kdy a na kolik měsíců (už vynásobené kusy). */
export interface Platba {
  kdy: Date;
  mesicu: number;
}

/**
 * Konec platnosti z plateb a ruční úpravy.
 *
 * Platby se berou v pořadí, jak přišly. Každá začíná dnem zaplacení,
 * nebo koncem předchozího období, když ještě běží (navazování). Ruční
 * úprava nastaví konec natvrdo a platby, které přišly před ní, už
 * nepočítá — administrátor je při úpravě viděl.
 */
export function spocitejKonec(
  platby: Platba[],
  rucne: { konec: Date; zadano: Date } | null,
): Date | null {
  let konec: Date | null = rucne?.konec ?? null;

  const serazene = [...platby].sort((a, b) => a.kdy.getTime() - b.kdy.getTime());
  for (const platba of serazene) {
    if (platba.mesicu <= 0) continue;
    if (rucne && platba.kdy.getTime() <= rucne.zadano.getTime()) continue;

    const denPlatby = zacatekDneOkamziku(platba.kdy);
    const zacatek = konec && konec.getTime() > denPlatby.getTime() ? konec : denPlatby;
    konec = pridejMesice(zacatek, platba.mesicu);
  }

  return konec;
}

/**
 * Spočítá znovu platnost všech produktů jednoho klienta a uloží ji.
 *
 * Volá se uvnitř transakce se změnou, která ji vyvolala — platnost se tak
 * nikdy nerozejde se stavem objednávek. Zaplacené objednávky v koši se
 * nepočítají, stejně jako u tržeb.
 *
 * Když se konec změní a k tomu starému už CRM založilo úkol na
 * prodloužení, úkol se uklidí: při prodloužení se odškrtne (klient
 * prodloužil, volat netřeba), při zkrácení nebo zrušení platby zmizí.
 * Nový úkol k novému konci založí `zalozUkolyNaProdlouzeni()`.
 */
export async function prepocitejPlatnost(tx: Transakce, clientId: string): Promise<void> {
  const [polozky, radky] = await Promise.all([
    tx.orderItem.findMany({
      where: {
        order: { clientId, status: "ZAPLACENO", deletedAt: null, paidAt: { not: null } },
      },
      select: {
        productId: true,
        quantity: true,
        validityMonths: true,
        product: { select: { validityMonths: true } },
        order: { select: { paidAt: true } },
      },
    }),
    tx.productValidity.findMany({
      where: { clientId },
      select: {
        id: true,
        productId: true,
        validUntil: true,
        manualUntil: true,
        manualAt: true,
        reminderForUntil: true,
        reminderTask: { select: { id: true, doneAt: true, deletedAt: true } },
      },
    }),
  ]);

  const platbyPodleProduktu = new Map<string, Platba[]>();
  for (const polozka of polozky) {
    // Délka opsaná při zaplacení; když produkt tehdy délku neměl, platí
    // jeho současná (starší objednávky z doby před platností).
    const mesicu =
      (polozka.validityMonths ?? polozka.product.validityMonths ?? 0) * polozka.quantity;
    if (mesicu <= 0 || !polozka.order.paidAt) continue;

    const seznam = platbyPodleProduktu.get(polozka.productId) ?? [];
    seznam.push({ kdy: polozka.order.paidAt, mesicu });
    platbyPodleProduktu.set(polozka.productId, seznam);
  }

  const radekProduktu = new Map(radky.map((radek) => [radek.productId, radek]));
  const produkty = new Set([...platbyPodleProduktu.keys(), ...radekProduktu.keys()]);

  for (const productId of produkty) {
    const radek = radekProduktu.get(productId);
    const rucne =
      radek?.manualUntil && radek.manualAt
        ? { konec: radek.manualUntil, zadano: radek.manualAt }
        : null;
    const konec = spocitejKonec(platbyPodleProduktu.get(productId) ?? [], rucne);

    if (!radek) {
      if (konec)
        await tx.productValidity.create({ data: { clientId, productId, validUntil: konec } });
      continue;
    }

    if ((radek.validUntil?.getTime() ?? null) === (konec?.getTime() ?? null)) continue;

    await tx.productValidity.update({ where: { id: radek.id }, data: { validUntil: konec } });

    // Úklid úkolu, který patřil k předchozímu konci.
    const ukol = radek.reminderTask;
    if (ukol && !ukol.doneAt && !ukol.deletedAt) {
      const prodlouzeno =
        konec !== null &&
        radek.reminderForUntil !== null &&
        konec.getTime() > radek.reminderForUntil.getTime();

      await tx.task.update({
        where: { id: ukol.id },
        data: prodlouzeno ? { doneAt: new Date() } : { deletedAt: new Date() },
      });
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "tasks",
        entityId: ukol.id,
        action: prodlouzeno ? "ukol.hotovy" : "ukol.smazan",
        after: {
          automaticky: true,
          duvod: prodlouzeno ? "klient prodloužil" : "platnost se změnila",
        },
      });
    }
  }
}

/** Text úkolu na prodloužení. Bez jména klienta — to ukazuje Můj den pod ním. */
export function textUkolu(produkt: string, konec: Date): string {
  return `Prodloužení: ${produkt} končí ${formatDatum(konec)}`;
}

/**
 * Založí úkoly na prodloužení u platností, které brzy končí.
 *
 * **Spouští se při otevření Dashboardu** — automatické spouštění podle
 * hodin aplikace nemá. Úkoly jsou vidět jen v Mém dni na Dashboardu,
 * takže se tím nikdy neopozdí.
 *
 * - Jen když je v Nastavení → Prodloužení vybraný aktivní člověk.
 * - Jen u platností, které končí dnes až za nastavený počet dní, a jen
 *   jednou pro každý konec (`reminderForUntil`). Kdo úkol smaže, druhý
 *   nedostane — dokud se konec nezmění.
 * - Souběžné otevření Dashboardu nezaloží úkol dvakrát: řádek se nejdřív
 *   „zabere" podmíněným zápisem a úkol vznikne jen tomu, komu to vyšlo.
 * - **Nic nevyhazuje.** Selhání nesmí shodit Dashboard.
 */
export async function zalozUkolyNaProdlouzeni(): Promise<void> {
  try {
    const nastaveni = await db.companySettings.findUnique({
      where: { id: "firma" },
      select: {
        renewalLeadDays: true,
        renewalUser: { select: { id: true, active: true, deletedAt: true } },
      },
    });

    const resitel = nastaveni?.renewalUser;
    if (!nastaveni || !resitel || !resitel.active || resitel.deletedAt) return;

    const dnes = dnesniZacatek();
    const hranice = posunDne(dnes, nastaveni.renewalLeadDays);

    const kandidati = await db.productValidity.findMany({
      where: { validUntil: { gte: dnes, lte: hranice }, client: { deletedAt: null } },
      select: {
        id: true,
        clientId: true,
        validUntil: true,
        reminderForUntil: true,
        product: { select: { name: true } },
      },
    });

    for (const kandidat of kandidati) {
      const konec = kandidat.validUntil!;
      if (kandidat.reminderForUntil?.getTime() === konec.getTime()) continue;

      await db.$transaction(async (tx) => {
        const zabrano = await tx.productValidity.updateMany({
          where: {
            id: kandidat.id,
            validUntil: konec,
            reminderForUntil: kandidat.reminderForUntil,
          },
          data: { reminderForUntil: konec },
        });
        if (zabrano.count === 0) return;

        const ukol = await tx.task.create({
          data: {
            clientId: kandidat.clientId,
            userId: resitel.id,
            title: textUkolu(kandidat.product.name, konec),
            // Termín je den konce — do té doby je čas zavolat, pak je
            // úkol „po termínu".
            dueAt: konec,
          },
          select: { id: true, title: true },
        });

        await tx.productValidity.update({
          where: { id: kandidat.id },
          data: { reminderTaskId: ukol.id },
        });

        // „Kdo" je prázdné — úkol nezaložil člověk, ale CRM samo.
        await zapisDoAuditu(tx, {
          userId: null,
          entity: "tasks",
          entityId: ukol.id,
          action: "ukol.zalozen",
          after: { title: ukol.title, komu: resitel.id, automaticky: true },
        });
      });
    }
  } catch (chyba) {
    // Do logu jen druh chyby, žádná jména klientů (pravidlo 8).
    console.error(
      "Úkoly na prodloužení nešly založit:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/**
 * Otevřené úkoly na prodloužení přejdou na nově vybraného člověka.
 * Volá se při změně v Nastavení → Prodloužení.
 */
export async function predejUkolyNaProdlouzeni(tx: Transakce, userId: string): Promise<number> {
  const vysledek = await tx.task.updateMany({
    where: { prodlouzeni: { isNot: null }, doneAt: null, deletedAt: null },
    data: { userId },
  });
  return vysledek.count;
}
