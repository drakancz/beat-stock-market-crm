import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";

import { upozorniKlienta } from "./oznameni";

/**
 * Upozornění klientovi na konec členství (krok 3A, Jakub 4. 10. 2026):
 * **týden předem a v den konce**, ke každému konci jen jednou.
 *
 * Spouští ho denní plánovač (`POST /api/planovac`). Kdo zmešká den
 * (výpadek plánovače), dostane upozornění při dalším spuštění — hledá se
 * celé okno „dnes až za týden", ne jen přesné datum. V den konce už
 * týdenní upozornění nepřijde, jen to „dnes".
 *
 * Kdo mezitím prodlouží, má jiný konec — `notified…ForUntil` se k němu
 * nehodí a upozornění přijde až k novému konci. Souběžné spuštění hlídá
 * podmíněný zápis (stejně jako úkoly na prodloužení v `platnost.ts`).
 *
 * Text oznámení nejmenuje produkt (ukazuje se na zamčené obrazovce),
 * e-mail ano.
 */

const DEN = 86_400_000;

/** „1 den", „3 dny", „7 dní". */
function dnu(pocet: number): string {
  if (pocet === 1) return "1 den";
  if (pocet >= 2 && pocet <= 4) return `${pocet} dny`;
  return `${pocet} dní`;
}

export interface VysledekKonce {
  tyden: number;
  den: number;
}

export async function upozorniNaKonecClenstvi(): Promise<VysledekKonce> {
  const vysledek: VysledekKonce = { tyden: 0, den: 0 };
  const dnes = dnesniZacatek();
  const zaTyden = posunDne(dnes, 7);

  const kandidati = await db.productValidity.findMany({
    where: {
      validUntil: { gte: dnes, lte: zaTyden },
      // Jen klienti s aktivním účtem — ostatním by upozornění nepřišlo.
      client: {
        deletedAt: null,
        mergedIntoId: null,
        ucet: { passwordHash: { not: null }, revokedAt: null },
      },
    },
    select: {
      id: true,
      clientId: true,
      validUntil: true,
      notifiedWeekForUntil: true,
      notifiedDayForUntil: true,
      product: { select: { name: true } },
    },
  });

  for (const k of kandidati) {
    const konec = k.validUntil!;
    const jeDnes = konec.getTime() === dnes.getTime();

    if (jeDnes) {
      if (k.notifiedDayForUntil?.getTime() === konec.getTime()) continue;
      const zabrano = await db.productValidity.updateMany({
        where: { id: k.id, validUntil: konec, notifiedDayForUntil: k.notifiedDayForUntil },
        data: { notifiedDayForUntil: konec, notifiedWeekForUntil: konec },
      });
      if (zabrano.count === 0) continue;

      await upozorniKlienta(k.clientId, {
        nadpis: "Členství dnes končí",
        text: "Jedno z vašich členství platí naposledy dnes. Podrobnosti najdete v klientské části.",
        odkaz: "/ucet",
        znacka: `konec-${k.id}`,
        odstavceEmailu: [
          `Dobrý den, vaše členství „${k.product.name}" platí naposledy dnes (${formatDatum(konec)}).`,
          "Když ho chcete prodloužit, stačí ho znovu objednat.",
        ],
      });
      vysledek.den += 1;
      continue;
    }

    if (k.notifiedWeekForUntil?.getTime() === konec.getTime()) continue;
    const zabrano = await db.productValidity.updateMany({
      where: { id: k.id, validUntil: konec, notifiedWeekForUntil: k.notifiedWeekForUntil },
      data: { notifiedWeekForUntil: konec },
    });
    if (zabrano.count === 0) continue;

    const zbyva = Math.round((konec.getTime() - dnes.getTime()) / DEN);
    await upozorniKlienta(k.clientId, {
      nadpis: "Členství brzy končí",
      text: `Jedno z vašich členství končí za ${dnu(zbyva)} (${formatDatum(konec)}).`,
      odkaz: "/ucet",
      znacka: `konec-${k.id}`,
      odstavceEmailu: [
        `Dobrý den, vaše členství „${k.product.name}" platí do ${formatDatum(konec)} včetně — zbývá ${dnu(zbyva)}.`,
        "Když ho chcete prodloužit, stačí ho znovu objednat. Zaplacené dny navazují, o žádný nepřijdete.",
      ],
    });
    vysledek.tyden += 1;
  }

  return vysledek;
}
