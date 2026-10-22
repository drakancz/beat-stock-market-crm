import { after } from "next/server";

import type { OrderStatus } from "@/generated/prisma/enums";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prepocitejOdmenu, type ZmenaOdmeny } from "@/lib/doporuceni";
import { upozorniNaZaplaceni } from "@/lib/klient/oznameni";
import { opisDelkuPlatnosti, prepocitejPlatnost } from "@/lib/platnost";
import { stitekPoZaplaceni } from "@/lib/pravidla";
import { vystavFakturu } from "@/lib/faktury/faktury";
import { dataObjednavky, posliWebhook } from "@/lib/webhooky";

/**
 * Změna stavu platby objednávky — **jediné místo**, kudy objednávka
 * zaplatí nebo se vrátí ze Zaplaceno (19. 10. 2026). Volá ho ruční přepnutí
 * administrátorem (`objednavky/actions.ts`) i platební brána
 * (`src/lib/platby/`). Všechno, co k zaplacení patří, se tak nerozejde:
 *
 * - `paidAt` (tržby v Cílech), délka platnosti do položek a přepočet
 *   platnosti členství,
 * - pravidlo Zaplaceno → štítek, odměna doporučiteli,
 * - po odpovědi upozornění klientovi a webhook „objednavka.zaplacena“.
 *
 * Kontrolu oprávnění dělá volající — tahle funkce ji nedělá.
 */

export interface ZmenaStavu {
  zmeneno: boolean;
  puvodni: OrderStatus;
  cislo: string;
  clientId: string;
  odmena: ZmenaOdmeny | null;
}

export async function zmenStavPlatby(
  orderId: string,
  novy: OrderStatus,
  kdo: { userId: string | null; zdroj?: "brana" },
): Promise<ZmenaStavu | null> {
  const objednavka = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, number: true, status: true, clientId: true, paidAt: true },
  });
  if (!objednavka) return null;
  if (objednavka.status === novy) {
    return {
      zmeneno: false,
      puvodni: objednavka.status,
      cislo: objednavka.number,
      clientId: objednavka.clientId,
      odmena: null,
    };
  }

  const odmena = await db.$transaction(async (tx) => {
    // Podmíněně — souběžné oznámení brány a ruční přepnutí neprojdou oba.
    const zmena = await tx.order.updateMany({
      where: { id: objednavka.id, status: objednavka.status },
      data: {
        status: novy,
        paidAt: novy === "ZAPLACENO" ? (objednavka.paidAt ?? new Date()) : null,
      },
    });
    if (zmena.count === 0) return undefined;

    if (novy === "ZAPLACENO" || objednavka.status === "ZAPLACENO") {
      await opisDelkuPlatnosti(tx, objednavka.id, novy === "ZAPLACENO");
      await prepocitejPlatnost(tx, objednavka.clientId);
    }

    await zapisDoAuditu(tx, {
      userId: kdo.userId,
      entity: "orders",
      entityId: objednavka.id,
      action: "objednavka.stav-zmenen",
      before: { stav: objednavka.status },
      after: { stav: novy, ...(kdo.zdroj === "brana" ? { brana: "GoPay" } : {}) },
    });

    await stitekPoZaplaceni(tx, objednavka.id);
    return prepocitejOdmenu(tx, objednavka.id, kdo.userId);
  });
  if (odmena === undefined) {
    return {
      zmeneno: false,
      puvodni: objednavka.status,
      cislo: objednavka.number,
      clientId: objednavka.clientId,
      odmena: null,
    };
  }

  if (novy === "ZAPLACENO") poZaplaceni(objednavka.id);

  return {
    zmeneno: true,
    puvodni: objednavka.status,
    cislo: objednavka.number,
    clientId: objednavka.clientId,
    odmena,
  };
}

/**
 * Co se děje po zaplacení až po odpovědi (výpadek služby nesmí nic zdržet):
 * faktura (19. 10. 2026), upozornění klientovi, které na ni odkáže,
 * a webhook. Volá ho `zmenStavPlatby()` i příjem objednávky, která
 * z Landing Page přijde rovnou zaplacená.
 */
export function poZaplaceni(orderId: string): void {
  after(async () => {
    try {
      await vystavFakturu(orderId, null);
    } catch (chyba) {
      console.error(
        "Fakturu se nepodařilo vystavit:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
    await upozorniNaZaplaceni(orderId);
  });
  posliWebhook("objednavka.zaplacena", () => dataObjednavky(orderId));
}
