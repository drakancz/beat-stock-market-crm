import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { upozorniKlienta } from "@/lib/klient/oznameni";
import { hraniceNechodi, podminkaNechodi } from "@/lib/nechodi";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import { MEZE, type Akce, type Podminka } from "@/lib/vlastni-pravidla-druhy";

/**
 * Vlastní pravidla „když platí podmínky, udělej akce“ (Fáze 5D, 2. část,
 * Jakub 19. 10. 2026).
 *
 * | Kdo           | Smí                                                     |
 * | ------------- | ------------------------------------------------------- |
 * | uživatel      | vidět je na stránce Pravidla (co dělají, kolikrát)      |
 * | administrátor | navíc skládat, zapínat, vypínat a mazat                 |
 *
 * - **Všechny podmínky musí platit najednou**, aspoň jedna je povinná —
 *   pravidlo bez podmínky by se týkalo všech klientů.
 * - **Jen ranní plánovač** (`spustVlastniPravidla()`), zprávy chodí ve
 *   slušnou hodinu.
 * - **Každému klientovi jednou** — `custom_rule_runs` (pravidlo + klient +
 *   `refKey`) se zapíše dřív, než se akce stane. U Nechodí a konce členství
 *   je `refKey` epizoda (poslední návštěva, konec členství), takže při další
 *   epizodě se pravidlo spustí znovu.
 * - Audit bez „kdo“ (Aktivita „CRM (pravidlo)“), nic nevyhazuje.
 */

const ID = z.string().trim().min(1).max(64);
const DNI = z.coerce
  .number({ error: "Počet dní musí být číslo." })
  .int("Počet dní musí být celé číslo.")
  .min(MEZE.dniOd, `Počet dní je aspoň ${MEZE.dniOd}.`)
  .max(MEZE.dniDo, `Počet dní je nejvýš ${MEZE.dniDo}.`);

export const podminkaSchema = z.discriminatedUnion("druh", [
  z.object({ druh: z.literal("stitek"), tagId: ID, ma: z.boolean() }),
  z.object({
    druh: z.literal("pole"),
    fieldId: ID,
    hodnota: z.string().trim().min(1, "Vyber hodnotu pole.").max(100),
  }),
  z.object({ druh: z.literal("nechodi"), dni: DNI }),
  z.object({ druh: z.literal("koupil"), productId: ID }),
  z.object({ druh: z.literal("konci"), dni: DNI }),
]);

export const akceSchema = z.discriminatedUnion("druh", [
  z.object({
    druh: z.literal("ukol"),
    userId: ID,
    nazev: z.string().trim().min(1, "Napiš název úkolu.").max(MEZE.nazevUkolu),
  }),
  z.object({
    druh: z.literal("zprava"),
    nadpis: z.string().trim().min(1, "Napiš nadpis zprávy.").max(MEZE.nadpisZpravy),
    text: z.string().trim().min(1, "Napiš text zprávy.").max(MEZE.textZpravy),
  }),
  z.object({ druh: z.literal("stitek"), tagId: ID, pridat: z.boolean() }),
]);

export const pravidloSchema = z.object({
  name: z.string().trim().min(1, "Pojmenuj pravidlo.").max(100, "Název je příliš dlouhý."),
  conditions: z
    .array(podminkaSchema)
    .min(1, "Přidej aspoň jednu podmínku — jinak by se pravidlo týkalo všech klientů.")
    .max(MEZE.podminek, `Podmínek může být nejvýš ${MEZE.podminek}.`),
  actions: z
    .array(akceSchema)
    .min(1, "Přidej aspoň jednu akci.")
    .max(MEZE.akci, `Akcí může být nejvýš ${MEZE.akci}.`),
});

/** Uložené podmínky a akce — co neprojde schématem, se bere jako prázdné. */
export function prectiPravidlo(ulozene: { conditions: unknown; actions: unknown }): {
  podminky: Podminka[];
  akce: Akce[];
} {
  const podminky = z.array(podminkaSchema).safeParse(ulozene.conditions);
  const akce = z.array(akceSchema).safeParse(ulozene.actions);
  return {
    podminky: podminky.success ? podminky.data : [],
    akce: akce.success ? akce.data : [],
  };
}

/** Podmínky jako dotaz na klienty — všechny najednou. */
export function dotazPodminek(podminky: Podminka[]): Prisma.ClientWhereInput {
  const dnes = dnesniZacatek();
  const casti: Prisma.ClientWhereInput[] = podminky.map((p) => {
    switch (p.druh) {
      case "stitek":
        return p.ma
          ? { stitky: { some: { tagId: p.tagId, tag: { deletedAt: null } } } }
          : { stitky: { none: { tagId: p.tagId } } };
      case "pole":
        return {
          vlastniPole: {
            some: { fieldId: p.fieldId, value: p.hodnota, field: { deletedAt: null } },
          },
        };
      case "nechodi":
        return podminkaNechodi(hraniceNechodi(p.dni));
      case "koupil":
        return {
          orders: {
            some: {
              status: "ZAPLACENO",
              deletedAt: null,
              items: { some: { productId: p.productId } },
            },
          },
        };
      case "konci":
        return {
          platnosti: { some: { validUntil: { gte: dnes, lte: posunDne(dnes, p.dni) } } },
        };
    }
  });
  return { AND: [{ deletedAt: null, mergedIntoId: null }, ...casti] };
}

/** Kolik klientů pravidlo teď splňuje — náhled na stránce Pravidla. */
export async function pocetSplnujicich(podminky: Podminka[]): Promise<number> {
  if (podminky.length === 0) return 0;
  return db.client.count({ where: dotazPodminek(podminky) });
}

/** Nejvýš tolik klientů jedno pravidlo zpracuje za jedno ráno. */
const NEJVIC_ZA_RANO = 1000;

/** Epizoda klienta pro `refKey`: návštěva u Nechodí, konec u členství. */
function klicEpizody(
  podminky: Podminka[],
  klient: { ucet: { lastSeenAt: Date | null } | null; platnosti: { validUntil: Date | null }[] },
): string {
  const casti: string[] = [];
  if (podminky.some((p) => p.druh === "nechodi")) {
    casti.push(klient.ucet?.lastSeenAt?.toISOString().slice(0, 16) ?? "bez-navstevy");
  }
  if (podminky.some((p) => p.druh === "konci")) {
    const konec = klient.platnosti
      .map((p) => p.validUntil)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    casti.push(konec ? konec.toISOString().slice(0, 10) : "bez-konce");
  }
  return casti.length > 0 ? casti.join("|") : "jednou";
}

/** Jedno pravidlo — vrátí, u kolika klientů se akce provedly. */
async function spustPravidlo(pravidlo: {
  id: string;
  name: string;
  conditions: unknown;
  actions: unknown;
}): Promise<number> {
  const { podminky, akce } = prectiPravidlo(pravidlo);
  if (podminky.length === 0 || akce.length === 0) return 0;

  // Úkol jen činnému kolegovi, štítek jen nesmazaný — jinak se akce vynechá.
  const lide = new Set(
    (
      await db.user.findMany({
        where: {
          id: { in: akce.flatMap((a) => (a.druh === "ukol" ? [a.userId] : [])) },
          active: true,
          deletedAt: null,
        },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const stitky = new Map(
    (
      await db.clientTag.findMany({
        where: {
          id: { in: akce.flatMap((a) => (a.druh === "stitek" ? [a.tagId] : [])) },
          deletedAt: null,
        },
        select: { id: true, name: true },
      })
    ).map((s) => [s.id, s.name]),
  );

  const dnes = dnesniZacatek();
  const klienti = await db.client.findMany({
    where: dotazPodminek(podminky),
    take: NEJVIC_ZA_RANO,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      ucet: { select: { lastSeenAt: true, passwordHash: true, revokedAt: true } },
      platnosti: { where: { validUntil: { gte: dnes } }, select: { validUntil: true } },
    },
  });

  let provedeno = 0;
  for (const klient of klienti) {
    try {
      const maUcet = !!klient.ucet?.passwordHash && !klient.ucet.revokedAt;
      const zpravy = await db.$transaction(async (tx) => {
        const zabrano = await tx.customRuleRun.createMany({
          data: [
            {
              ruleId: pravidlo.id,
              clientId: klient.id,
              refKey: klicEpizody(podminky, klient),
              detail: pravidlo.name.slice(0, 200),
            },
          ],
          skipDuplicates: true,
        });
        if (zabrano.count === 0) return null;

        const kOdeslani: { id: string; nadpis: string; text: string }[] = [];
        for (const a of akce) {
          if (a.druh === "ukol" && lide.has(a.userId)) {
            const ukol = await tx.task.create({
              data: { clientId: klient.id, userId: a.userId, title: a.nazev, dueAt: dnes },
              select: { id: true },
            });
            await zapisDoAuditu(tx, {
              userId: null,
              entity: "tasks",
              entityId: ukol.id,
              action: "ukol.zalozen",
              after: { title: a.nazev, klient: klient.id, pravidlo: pravidlo.name },
            });
          } else if (a.druh === "stitek" && stitky.has(a.tagId)) {
            const zmena = a.pridat
              ? await tx.clientTagLink.createMany({
                  data: [{ clientId: klient.id, tagId: a.tagId, addedById: null }],
                  skipDuplicates: true,
                })
              : await tx.clientTagLink.deleteMany({
                  where: { clientId: klient.id, tagId: a.tagId },
                });
            if (zmena.count > 0) {
              await zapisDoAuditu(tx, {
                userId: null,
                entity: "clients",
                entityId: klient.id,
                action: a.pridat ? "klient.stitek-pridan" : "klient.stitek-odebran",
                after: { stitek: stitky.get(a.tagId), pravidlo: pravidlo.name },
              });
            }
          } else if (a.druh === "zprava" && maUcet) {
            const zprava = await tx.clientMessage.create({
              data: { clientId: klient.id, authorId: null, text: a.text, delivery: "JEN_UCET" },
              select: { id: true },
            });
            await zapisDoAuditu(tx, {
              userId: null,
              entity: "clients",
              entityId: klient.id,
              action: "klient.zprava-odeslana",
              after: { klient: klient.name, zprava: zprava.id, pravidlo: pravidlo.name },
            });
            kOdeslani.push({ id: zprava.id, nadpis: a.nadpis, text: a.text });
          }
        }
        return kOdeslani;
      });
      if (!zpravy) continue;
      provedeno += 1;

      // Doručení až po uložení, stejně jako zpráva od administrátora.
      for (const zprava of zpravy) {
        const doruceni = await upozorniKlienta(klient.id, {
          nadpis: zprava.nadpis,
          text: zprava.text,
          odkaz: "/ucet/zpravy",
          znacka: `zprava-${zprava.id}`,
          odstavceEmailu: [zprava.text],
        });
        await db.clientMessage.update({
          where: { id: zprava.id },
          data: { delivery: doruceni === "BEZ_UCTU" ? "JEN_UCET" : doruceni },
        });
      }
    } catch (chyba) {
      // Jeden klient nesmí zastavit ostatní. Do logu jen druh chyby.
      console.error(
        "Vlastní pravidlo selhalo:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }
  return provedeno;
}

/** Ranní běh všech zapnutých vlastních pravidel — volá ho jen plánovač. */
export async function spustVlastniPravidla(): Promise<number> {
  const pravidla = await db.customRule.findMany({
    where: { enabled: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, conditions: true, actions: true },
  });
  let celkem = 0;
  for (const pravidlo of pravidla) {
    try {
      celkem += await spustPravidlo(pravidlo);
    } catch (chyba) {
      console.error(
        "Vlastní pravidlo selhalo:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }
  return celkem;
}
