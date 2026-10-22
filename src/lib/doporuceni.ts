import { zapisDoAuditu, type Transakce } from "@/lib/audit";
import { cenaPolozkyBezDph } from "@/lib/dph";

/**
 * Doporučení a odměny (Fáze 5A, 2. část, Jakub 15. 10. 2026).
 *
 * Doporučitel — stávající klient nebo partner zvenku — má vlastní slevový
 * kód. Pravidla, která Jakub vybral:
 *
 * 1. **Přivedený je jen nový klient.** Kdo objedná s kódem doporučitele
 *    a v CRM ještě žádnou objednávku nemá, dostane „Přivedl: …“. Klient,
 *    který už dřív objednal, slevu dostane, ale nikoho nepřivedl.
 * 2. **Kdo klienta přivedl, se zapíše jednou a nepřepíše se** — ani když
 *    později objedná s kódem jiného doporučitele.
 * 3. **Sám sebe doporučit nejde** — klient s vlastním kódem slevu dostane,
 *    odměnu ne.
 * 4. **Odměna je procento z první zaplacené objednávky**, z ceny po slevě
 *    bez DPH. Procento i základ se zamrazí ve chvíli zaplacení.
 * 5. **Vyplácí se ručně**, administrátor odměnu jen odškrtne. Když se
 *    objednávka vrátí ze Zaplaceno nebo smaže, nevyplacená odměna zmizí;
 *    **vyplacená zůstane** — peníze už odešly.
 *
 * Doporučitele, procenta a odměny vidí **jen administrátor**; ostatní jen
 * „Přivedl: …“ na kartě klienta.
 */

/**
 * Zapíše doporučení u objednávky z Landing Page, pokud na ně má nárok
 * (pravidla 1–3). Volá se v transakci příjmu, hned po založení objednávky.
 *
 * Vrací, jestli se doporučení zapsalo.
 */
export async function zapisDoporuceni(
  tx: Transakce,
  {
    objednavkaId,
    klientId,
    doporucitelId,
  }: {
    objednavkaId: string;
    klientId: string;
    doporucitelId: string;
  },
): Promise<boolean> {
  const doporucitel = await tx.referrer.findFirst({
    where: { id: doporucitelId, deletedAt: null },
    select: { id: true, name: true, clientId: true },
  });
  if (!doporucitel) return false;
  if (doporucitel.clientId === klientId) return false;

  const klient = await tx.client.findUniqueOrThrow({
    where: { id: klientId },
    select: { referredById: true },
  });
  if (klient.referredById) return false;

  // Nový klient = žádná jiná objednávka, smazané se nepočítají.
  const driv = await tx.order.count({
    where: { clientId: klientId, deletedAt: null, id: { not: objednavkaId } },
  });
  if (driv > 0) return false;

  await tx.client.update({ where: { id: klientId }, data: { referredById: doporucitel.id } });
  await tx.order.update({ where: { id: objednavkaId }, data: { referrerId: doporucitel.id } });

  await zapisDoAuditu(tx, {
    userId: null,
    entity: "clients",
    entityId: klientId,
    action: "doporuceni.zapsano",
    after: { doporucitel: doporucitel.name, objednavkaId },
  });
  return true;
}

export type ZmenaOdmeny = "vznikla" | "zrusena" | "vyplacena-zustava" | null;

/**
 * Srovná odměnu se stavem objednávky (pravidla 4 a 5).
 *
 * Volá se všude, kde se mění, jestli je objednávka zaplacená a nesmazaná:
 * příjem zaplacené objednávky, přepnutí stavu, smazání do koše a obnovení.
 * Je bezpečné ji volat opakovaně — dělá jen to, co chybí.
 *
 * Vrací, co se stalo; `vyplacena-zustava` znamená, že objednávka nárok
 * ztratila, ale odměna je už vyplacená, a tak zůstává.
 */
export async function prepocitejOdmenu(
  tx: Transakce,
  objednavkaId: string,
  kdo: string | null,
): Promise<ZmenaOdmeny> {
  const objednavka = await tx.order.findUniqueOrThrow({
    where: { id: objednavkaId },
    select: {
      id: true,
      number: true,
      status: true,
      deletedAt: true,
      currency: true,
      referrer: { select: { id: true, name: true, rewardPercent: true } },
      odmena: { select: { id: true, amount: true, paidOutAt: true } },
      items: {
        select: {
          quantity: true,
          netPrice: true,
          vatPercent: true,
          product: { select: { netPrice: true } },
        },
      },
    },
  });

  const narok =
    objednavka.referrer !== null &&
    objednavka.status === "ZAPLACENO" &&
    objednavka.deletedAt === null;

  if (narok && !objednavka.odmena) {
    const doporucitel = objednavka.referrer!;
    const zaklad = objednavka.items.reduce(
      (soucet, polozka) => soucet + polozka.quantity * cenaPolozkyBezDph(polozka),
      0,
    );
    const procento = doporucitel.rewardPercent.toNumber();
    const zakladNaHalere = Math.round(zaklad * 100) / 100;
    const castka = Math.round(zakladNaHalere * procento) / 100;

    const odmena = await tx.referralReward.create({
      data: {
        referrerId: doporucitel.id,
        orderId: objednavka.id,
        percent: procento,
        base: zakladNaHalere,
        amount: castka,
        currency: objednavka.currency,
      },
      select: { id: true },
    });
    await zapisDoAuditu(tx, {
      userId: kdo,
      entity: "referral_rewards",
      entityId: odmena.id,
      action: "odmena.vznikla",
      after: {
        doporucitel: doporucitel.name,
        objednavka: objednavka.number,
        procento,
        zaklad: zakladNaHalere,
        castka,
      },
    });
    return "vznikla";
  }

  if (!narok && objednavka.odmena) {
    if (objednavka.odmena.paidOutAt) return "vyplacena-zustava";
    await tx.referralReward.delete({ where: { id: objednavka.odmena.id } });
    await zapisDoAuditu(tx, {
      userId: kdo,
      entity: "referral_rewards",
      entityId: objednavka.odmena.id,
      action: "odmena.zrusena",
      before: {
        doporucitel: objednavka.referrer?.name ?? null,
        objednavka: objednavka.number,
        castka: objednavka.odmena.amount.toNumber(),
      },
    });
    return "zrusena";
  }

  return null;
}
