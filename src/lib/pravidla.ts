import { type Transakce, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniKlienta } from "@/lib/klient/oznameni";
import { aktualniHraniceNechodi, podminkaNechodi } from "@/lib/nechodi";
import type { IdPravidla } from "@/lib/pravidla-druhy";
import { nactiKurzKlienta } from "@/lib/vzdelavani/klient";
import { okamzikOtevreni, prvniZaplaceniKurzu } from "@/lib/vzdelavani/odemykani";

/**
 * Hotová pravidla „když se stane X, udělej Y“ (Fáze 5D, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                          |
 * | ------------- | ------------------------------------------------------------ |
 * | uživatel      | vidět stránku Pravidla (co běží a kolikrát se to stalo)      |
 * | administrátor | navíc pravidla zapnout, vypnout a nastavit                   |
 * | nepřihlášený  | nic                                                          |
 *
 * - Nechodí → úkol, Nechodí → zpráva a Odemčená lekce → oznámení spouští
 *   **jen ranní plánovač** (`POST /api/planovac`) — zprávy chodí ve
 *   slušnou hodinu. Zaplaceno → štítek běží hned při zaplacení.
 * - **Každá akce jen jednou**: dřív, než se něco stane, se zapíše řádek do
 *   `automation_runs` s jedinečnou trojicí pravidlo + klient + `refKey`.
 *   Souběžné spuštění plánovače se tak nepotká.
 * - Audit bez „kdo“ (udělalo to CRM), na časové ose klienta druh Tým.
 * - Nic nevyhazuje — selhání pravidla nesmí shodit plánovač ani platbu.
 */

/** Jak dlouho zpětně se oznamuje otevřená lekce — zmeškané ráno se dožene. */
const OKNO_OZNAMENI_LEKCE_DNI = 3;

export async function nactiPravidla() {
  const [pravidla, pocty] = await Promise.all([
    db.automationRule.findMany({
      select: {
        id: true,
        enabled: true,
        messageTitle: true,
        messageText: true,
        productId: true,
        tagId: true,
        updatedAt: true,
        product: { select: { name: true, deletedAt: true } },
        tag: { select: { name: true, deletedAt: true } },
      },
    }),
    db.automationRun.groupBy({ by: ["ruleId"], _count: { _all: true } }),
  ]);
  // Dvojice Zaplaceno → štítek (18. 10. 2026) — bez smazaných produktů a štítků.
  const dvojice = await db.automationTagPair.findMany({
    where: { product: { deletedAt: null }, tag: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      productId: true,
      tagId: true,
      product: { select: { name: true } },
      tag: { select: { name: true } },
    },
  });
  const provedeno = new Map(pocty.map((radek) => [radek.ruleId, radek._count._all]));
  return pravidla.map((pravidlo) => ({
    ...pravidlo,
    provedeno: provedeno.get(pravidlo.id) ?? 0,
    dvojice: pravidlo.id === "zaplaceno-stitek" ? dvojice : [],
  }));
}

async function zapnute(id: IdPravidla) {
  return db.automationRule.findFirst({
    where: { id, enabled: true },
    select: {
      messageTitle: true,
      messageText: true,
      productId: true,
      tagId: true,
    },
  });
}

/**
 * Zabere akci pro klienta: `true` = ještě se nestala a teď patří tomuhle
 * běhu. Volá se uvnitř transakce s tím, co pravidlo dělá.
 */
async function zaber(
  tx: Transakce,
  ruleId: IdPravidla,
  clientId: string,
  refKey: string,
  detail: string | null,
): Promise<boolean> {
  const zapsano = await tx.automationRun.createMany({
    data: [{ ruleId, clientId, refKey, detail }],
    skipDuplicates: true,
  });
  return zapsano.count > 0;
}

/** Klíč jedné epizody „nechodí“: končí, když klient přijde. */
function klicNechodi(posledniNavsteva: Date | null): string {
  return posledniNavsteva ? posledniNavsteva.toISOString() : "bez-navstevy";
}

async function nechodiciKlienti(jenSUctem: boolean) {
  const { hranice } = await aktualniHraniceNechodi();
  return db.client.findMany({
    where: {
      AND: [
        { deletedAt: null, mergedIntoId: null },
        podminkaNechodi(hranice),
        jenSUctem ? { ucet: { is: { passwordHash: { not: null }, revokedAt: null } } } : {},
      ],
    },
    select: { id: true, name: true, ucet: { select: { lastSeenAt: true } } },
  });
}

/** Nechodí → zpráva klientovi s účtem. Vrátí, kolik zpráv odešlo. */
async function nechodiZprava(): Promise<number> {
  const pravidlo = await zapnute("nechodi-zprava");
  if (!pravidlo?.messageTitle || !pravidlo.messageText) return 0;
  const { messageTitle: nadpis, messageText: text } = pravidlo;

  let odeslano = 0;
  for (const klient of await nechodiciKlienti(true)) {
    const zprava = await db.$transaction(async (tx) => {
      const klic = klicNechodi(klient.ucet?.lastSeenAt ?? null);
      if (!(await zaber(tx, "nechodi-zprava", klient.id, klic, nadpis))) return null;
      const ulozena = await tx.clientMessage.create({
        data: { clientId: klient.id, authorId: null, text, delivery: "JEN_UCET" },
        select: { id: true },
      });
      await zapisDoAuditu(tx, {
        userId: null,
        entity: "clients",
        entityId: klient.id,
        action: "klient.zprava-odeslana",
        after: { klient: klient.name, zprava: ulozena.id, pravidlo: "nechodi-zprava" },
      });
      return ulozena;
    });
    if (!zprava) continue;

    // Doručení až po uložení, stejně jako zpráva od administrátora.
    const doruceni = await upozorniKlienta(klient.id, {
      nadpis,
      text,
      odkaz: "/ucet/zpravy",
      znacka: `zprava-${zprava.id}`,
      odstavceEmailu: [text],
    });
    await db.clientMessage.update({
      where: { id: zprava.id },
      data: { delivery: doruceni === "BEZ_UCTU" ? "JEN_UCET" : doruceni },
    });
    odeslano += 1;
  }
  return odeslano;
}

/**
 * Odemčená lekce → oznámení. Jen lekce, které se otevřely podle dnů nebo
 * data v posledních dnech (`OKNO_OZNAMENI_LEKCE_DNI`) — zapnutí pravidla
 * tak nerozešle oznámení o všech starších lekcích. Víc lekcí najednou =
 * jedno oznámení. Vrátí, kolik klientů ho dostalo.
 */
async function lekceOznameni(): Promise<number> {
  if (!(await zapnute("lekce-oznameni"))) return 0;

  const ted = new Date();
  const od = new Date(ted.getTime() - OKNO_OZNAMENI_LEKCE_DNI * 86_400_000);
  const kurzy = await db.course.findMany({
    where: {
      deletedAt: null,
      publishedAt: { not: null },
      lekce: {
        some: {
          deletedAt: null,
          OR: [{ unlockAfterDays: { gt: 0 } }, { unlockOn: { not: null } }],
        },
      },
    },
    select: {
      id: true,
      productId: true,
      lekce: {
        where: { deletedAt: null },
        select: { id: true, unlockAfterDays: true, unlockOn: true, unlockAfterPrevious: true },
      },
    },
  });

  let upozorneno = 0;
  for (const kurz of kurzy) {
    const klienti = await db.client.findMany({
      where: {
        deletedAt: null,
        mergedIntoId: null,
        ucet: { is: { passwordHash: { not: null }, revokedAt: null } },
        orders: {
          some: {
            status: "ZAPLACENO",
            deletedAt: null,
            items: { some: { productId: kurz.productId } },
          },
        },
      },
      select: { id: true },
    });

    for (const { id: clientId } of klienti) {
      const zaplaceno = await prvniZaplaceniKurzu(clientId, kurz.productId);
      const cerstve = kurz.lekce.filter((lekce) => {
        const kdy = okamzikOtevreni(lekce, zaplaceno);
        return kdy !== null && kdy <= ted && kdy >= od;
      });
      if (cerstve.length === 0) continue;

      // Otevřená = i podmínka „po předchozí“ je splněná (`nactiKurzKlienta()`).
      const stav = await nactiKurzKlienta(clientId, kurz.id);
      const otevrene = new Set(stav?.lekce.filter((l) => !l.zamcena).map((l) => l.id));
      const nove: string[] = [];
      for (const lekce of cerstve.filter((l) => otevrene.has(l.id))) {
        const zabrano = await db.$transaction((tx) =>
          zaber(tx, "lekce-oznameni", clientId, lekce.id, "oznámení o otevřené lekci"),
        );
        if (zabrano) nove.push(lekce.id);
      }
      if (nove.length === 0) continue;

      await upozorniKlienta(clientId, {
        nadpis: nove.length === 1 ? "Otevřela se vám nová lekce" : "Otevřely se vám nové lekce",
        text:
          nove.length === 1
            ? "V kurzu na vás čeká nová lekce."
            : `V kurzu na vás čekají nové lekce (${nove.length}).`,
        odkaz: `/ucet/kurzy/${kurz.id}`,
        znacka: `lekce-${kurz.id}`,
      });
      upozorneno += 1;
    }
  }
  return upozorneno;
}

/** Ranní běh pravidel — volá ho jen denní plánovač. */
export async function spustRanniPravidla(): Promise<{
  zpravy: number;
  lekce: number;
}> {
  const vysledek = { zpravy: 0, lekce: 0 };
  for (const [klic, beh] of [
    ["zpravy", nechodiZprava],
    ["lekce", lekceOznameni],
  ] as const) {
    try {
      vysledek[klic] = await beh();
    } catch (chyba) {
      // Jen druh chyby, žádná jména klientů (pravidlo 8).
      console.error(
        `Pravidlo (${klic}) selhalo:`,
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }
  return vysledek;
}

/**
 * Zaplaceno → štítek. Volá se ve stejné transakci jako zaplacení (ruční
 * přepnutí, příjem z Landing Page, obnovení objednávky). U nezaplacené
 * objednávky nedělá nic. Každá dvojice produkt → štítek (`automation_tag_pairs`)
 * se u klienta uplatní jednou — když štítek kolega odebere, další platba
 * ho znovu nepřidá.
 */
export async function stitekPoZaplaceni(tx: Transakce, orderId: string): Promise<void> {
  const zapnuto = await tx.automationRule.findFirst({
    where: { id: "zaplaceno-stitek", enabled: true },
    select: { id: true },
  });
  if (!zapnuto) return;

  const objednavka = await tx.order.findFirst({
    where: { id: orderId, status: "ZAPLACENO", deletedAt: null, client: { deletedAt: null } },
    select: { clientId: true, items: { select: { productId: true } } },
  });
  if (!objednavka) return;

  // Všechny dvojice, jejichž produkt je v objednávce — dva kurzy = dva štítky.
  const dvojice = await tx.automationTagPair.findMany({
    where: {
      productId: { in: objednavka.items.map((polozka) => polozka.productId) },
      tag: { deletedAt: null },
    },
    select: { productId: true, tagId: true, tag: { select: { name: true } } },
  });

  for (const par of dvojice) {
    // Klíč produkt + štítek: odebraný štítek se dalším zaplacením nevrátí.
    const klic = `${par.productId}:${par.tagId}`;
    const detail = `štítek ${par.tag.name}`;
    if (!(await zaber(tx, "zaplaceno-stitek", objednavka.clientId, klic, detail))) continue;
    const pridano = await tx.clientTagLink.createMany({
      data: [{ clientId: objednavka.clientId, tagId: par.tagId, addedById: null }],
      skipDuplicates: true,
    });
    if (pridano.count === 0) continue;
    await zapisDoAuditu(tx, {
      userId: null,
      entity: "clients",
      entityId: objednavka.clientId,
      action: "klient.stitek-pridan",
      after: { stitek: par.tag.name, pravidlo: "zaplaceno-stitek" },
    });
  }
}
