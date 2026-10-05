"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { pocet } from "@/lib/mnozne";
import { prepocitejPlatnost } from "@/lib/platnost";
import { requireAdmin } from "@/lib/session";

import { DRUHY } from "./druhy";

/**
 * Společný koš — obnovení a trvalé smazání.
 *
 * **Smí to jen administrátor** a ověřuje se to tady na serveru, ne tím,
 * že se obrazovka nikomu jinému neukáže (security_warnings.md, pravidlo 5).
 *
 * Obnovení jen smaže značku `deletedAt`, takže se záznam vrátí přesně
 * tam, odkud zmizel — klient mezi klienty, broker do seznamu brokerů,
 * uživatel do týmu. Nic dalšího se nemění: kdo měl odebraný přístup, má
 * ho odebraný dál.
 *
 * **Trvalé smazání je jediné místo v systému, kde záznam opravdu zmizí.**
 * Pouští se jen tam, kde po sobě nic nenechal — jinak by v auditním logu
 * u dřívějších změn zůstalo prázdné „kdo" a historie by přestala dokládat,
 * co má (pravidlo 7).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const vstup = z.object({
  druh: z.enum(DRUHY),
  id: z.string().trim().min(1).max(64),
});

/** Obnoví všechny obrazovky, kterých se změna může týkat. */
function obnovStranky() {
  revalidatePath("/smazane");
  revalidatePath("/klienti");
  revalidatePath("/objednavky");
  revalidatePath("/portfolia");
  revalidatePath("/produkty");
  revalidatePath("/brokeri");
  revalidatePath("/sprava");
  revalidatePath("/sprava/uzivatele");
  revalidatePath("/dashboard");
}

export async function obnovZaznam(druhRaw: string, idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const data = vstup.safeParse({ druh: druhRaw, id: idRaw });
  if (!data.success) return { ok: false, chyba: "Neplatný požadavek." };

  const { druh, id } = data.data;

  switch (druh) {
    case "klient": {
      const klient = await db.client.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          deletedAt: true,
          mergedInto: { select: { name: true } },
        },
      });
      if (!klient?.deletedAt) return { ok: false, chyba: "Tenhle klient v koši není." };
      // Sloučená karta je prázdná — všechno je na kartě, do které se sloučila.
      if (klient.mergedInto) {
        return {
          ok: false,
          chyba: `Karta je sloučená do karty ${klient.mergedInto.name}, vrátit ji nejde.`,
        };
      }

      await db.$transaction(async (tx) => {
        await tx.client.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "clients",
          entityId: id,
          action: "klient.obnoven",
          after: { name: klient.name },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `${klient.name} je zpátky mezi klienty.` };
    }

    case "objednavka": {
      const objednavka = await db.order.findUnique({
        where: { id },
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          clientId: true,
          deletedAt: true,
          client: { select: { name: true } },
        },
      });
      if (!objednavka?.deletedAt) return { ok: false, chyba: "Tahle objednávka v koši není." };

      await db.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { deletedAt: null } });
        // Vrácená zaplacená objednávka se znovu počítá do platnosti členství.
        if (objednavka.status === "ZAPLACENO") {
          await prepocitejPlatnost(tx, objednavka.clientId);
        }
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "orders",
          entityId: id,
          action: "objednavka.obnovena",
          after: {
            cislo: objednavka.number,
            name: objednavka.name,
            klient: objednavka.client.name,
          },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `Zpátky mezi objednávkami: ${objednavka.number}.` };
    }

    case "hovor": {
      const hovor = await db.call.findUnique({
        where: { id },
        select: {
          id: true,
          at: true,
          outcome: true,
          deletedAt: true,
          client: { select: { name: true } },
        },
      });
      if (!hovor?.deletedAt) return { ok: false, chyba: "Tenhle hovor v koši není." };

      await db.$transaction(async (tx) => {
        await tx.call.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "calls",
          entityId: id,
          action: "hovor.obnoven",
          after: { klient: hovor.client.name, at: hovor.at.toISOString(), vysledek: hovor.outcome },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `Hovor s klientem ${hovor.client.name} je zpátky.` };
    }

    case "portfolio": {
      const portfolio = await db.portfolio.findUnique({
        where: { id },
        select: {
          id: true,
          deletedAt: true,
          client: { select: { name: true } },
          broker: { select: { name: true } },
        },
      });
      if (!portfolio?.deletedAt) return { ok: false, chyba: "Tohle portfolio v koši není." };

      await db.$transaction(async (tx) => {
        await tx.portfolio.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "portfolios",
          entityId: id,
          action: "portfolio.obnoveno",
          after: { klient: portfolio.client.name, broker: portfolio.broker.name },
        });
      });

      obnovStranky();
      return {
        ok: true,
        zprava: `Portfolio ${portfolio.client.name} u ${portfolio.broker.name} je zpátky.`,
      };
    }

    case "produkt": {
      const produkt = await db.product.findUnique({
        where: { id },
        select: { id: true, name: true, deletedAt: true },
      });
      if (!produkt?.deletedAt) return { ok: false, chyba: "Tenhle produkt v koši není." };

      // Po smazání mohl vzniknout nový produkt se stejným názvem. Dva
      // stejné by se v ceníku pletly a příjem objednávek by nevěděl, který.
      const kolize = await db.product.findFirst({
        where: { deletedAt: null, name: { equals: produkt.name, mode: "insensitive" } },
        select: { name: true },
      });
      if (kolize) {
        return {
          ok: false,
          chyba: `V ceníku už je produkt ${kolize.name}. Přejmenuj ho, pak půjde tenhle obnovit.`,
        };
      }

      await db.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "products",
          entityId: id,
          action: "produkt.obnoven",
          after: { name: produkt.name },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `Zpátky v ceníku: ${produkt.name}.` };
    }

    case "broker": {
      const broker = await db.broker.findUnique({
        where: { id },
        select: { id: true, name: true, deletedAt: true },
      });
      if (!broker?.deletedAt) return { ok: false, chyba: "Tenhle broker v koši není." };

      await db.$transaction(async (tx) => {
        await tx.broker.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "broker",
          entityId: id,
          action: "broker.obnoven",
          after: { name: broker.name },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `${broker.name} je zpátky v seznamu brokerů.` };
    }

    case "uzivatel": {
      const uzivatel = await db.user.findUnique({
        where: { id },
        select: { id: true, name: true, active: true, deletedAt: true },
      });
      if (!uzivatel?.deletedAt) return { ok: false, chyba: "Tenhle účet v koši není." };

      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "users",
          entityId: id,
          action: "uzivatel.obnoven",
          after: { name: uzivatel.name },
        });
      });

      obnovStranky();
      return {
        ok: true,
        zprava: uzivatel.active
          ? `${uzivatel.name} je zpátky v týmu.`
          : `${uzivatel.name} je zpátky v seznamu, ale s odebraným přístupem.`,
      };
    }
  }
}

export async function smazZaznamNadobro(druhRaw: string, idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const data = vstup.safeParse({ druh: druhRaw, id: idRaw });
  if (!data.success) return { ok: false, chyba: "Neplatný požadavek." };

  const { druh, id } = data.data;

  switch (druh) {
    case "klient": {
      const klient = await db.client.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          deletedAt: true,
          mergedIntoId: true,
          _count: {
            select: {
              calls: true,
              tasks: true,
              portfolios: true,
              activities: true,
              orders: true,
              // Zprávy do klientské části (3A, 4. 10. 2026) jsou historie.
              zpravy: true,
              // Účast na webinářích (3C) je taky historie.
              ucastNaWebinarich: true,
            },
          },
        },
      });
      if (!klient?.deletedAt) return { ok: false, chyba: "Tenhle klient v koši není." };

      // Sloučená karta drží odkaz pro příjem objednávek na její e-mail.
      if (klient.mergedIntoId) {
        return {
          ok: false,
          chyba: `${klient.name} je sloučená karta — podle ní se objednávky na starý e-mail zapisují ke správnému klientovi. Nadobro smazat nejde.`,
        };
      }

      const { calls, tasks, portfolios, activities, orders, zpravy, ucastNaWebinarich } =
        klient._count;
      if (
        calls > 0 ||
        tasks > 0 ||
        portfolios > 0 ||
        activities > 0 ||
        orders > 0 ||
        zpravy > 0 ||
        ucastNaWebinarich > 0
      ) {
        return {
          ok: false,
          chyba: `${klient.name} má v systému historii (objednávky, hovory, úkoly, portfolia, zprávy nebo účast na webinářích). Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "clients",
          entityId: id,
          action: "klient.smazan",
          before: { name: klient.name, email: klient.email },
        });
        await tx.client.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${klient.name}.` };
    }

    case "objednavka": {
      const objednavka = await db.order.findUnique({
        where: { id },
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          deletedAt: true,
          client: { select: { name: true } },
          _count: { select: { items: true } },
        },
      });
      if (!objednavka?.deletedAt) return { ok: false, chyba: "Tahle objednávka v koši není." };

      // Objednávka se maže vždycky: nic na ní nevisí a objednané produkty
      // mizí s ní (v databázi to zařídí kaskáda). Stopa po ní zůstane
      // v auditním logu, takže historie o nic nepřijde.
      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "orders",
          entityId: id,
          action: "objednavka.smazana",
          before: {
            cislo: objednavka.number,
            name: objednavka.name,
            klient: objednavka.client.name,
            stav: objednavka.status,
            polozek: objednavka._count.items,
          },
        });
        await tx.order.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: objednávka ${objednavka.number}.` };
    }

    case "hovor": {
      const hovor = await db.call.findUnique({
        where: { id },
        select: {
          id: true,
          at: true,
          durationMin: true,
          outcome: true,
          note: true,
          deletedAt: true,
          client: { select: { name: true } },
          user: { select: { name: true } },
        },
      });
      if (!hovor?.deletedAt) return { ok: false, chyba: "Tenhle hovor v koši není." };

      // Hovor se maže vždycky: nic na něm nevisí. Stopa po něm zůstane
      // v auditním logu, takže historie o nic nepřijde. Text poznámky
      // se do logu nedává ani tady — bývá o tom, co klient řekl
      // (security_warnings.md, pravidlo 8).
      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "calls",
          entityId: id,
          action: "hovor.smazan",
          before: {
            klient: hovor.client.name,
            zapsal: hovor.user.name,
            at: hovor.at.toISOString(),
            minut: hovor.durationMin,
            vysledek: hovor.outcome,
            maPoznamku: hovor.note.length > 0,
          },
        });
        await tx.call.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Hovor s klientem ${hovor.client.name} je nadobro smazaný.` };
    }

    case "portfolio": {
      const portfolio = await db.portfolio.findUnique({
        where: { id },
        select: {
          id: true,
          deletedAt: true,
          client: { select: { name: true } },
          broker: { select: { name: true } },
          _count: { select: { positions: true } },
        },
      });
      if (!portfolio?.deletedAt) return { ok: false, chyba: "Tohle portfolio v koši není." };

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "portfolios",
          entityId: id,
          action: "portfolio.smazano",
          before: {
            klient: portfolio.client.name,
            broker: portfolio.broker.name,
            pozic: portfolio._count.positions,
          },
        });
        // Pozice v portfoliu mizí s ním — v databázi to zařídí kaskáda.
        await tx.portfolio.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Portfolio ${portfolio.client.name} je nadobro smazané.` };
    }

    case "produkt": {
      const produkt = await db.product.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          kind: true,
          deletedAt: true,
          _count: { select: { orders: true, calls: true, platnosti: true, kurzy: true } },
        },
      });
      if (!produkt?.deletedAt) return { ok: false, chyba: "Tenhle produkt v koši není." };

      // Objednávky, platnost členství i hovory na produkt odkazují. Kdyby
      // zmizel, z historie by se ztratilo, co si klient koupil.
      const { orders, calls, platnosti, kurzy } = produkt._count;
      if (orders > 0 || calls > 0 || platnosti > 0 || kurzy > 0) {
        return {
          ok: false,
          chyba: `${produkt.name} je v objednávkách, platnosti členství, u hovoru nebo má obsah kurzu ve Vzdělávání. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "products",
          entityId: id,
          action: "produkt.smazan",
          before: { name: produkt.name, druh: produkt.kind },
        });
        await tx.product.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${produkt.name}.` };
    }

    case "broker": {
      const broker = await db.broker.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          autoConnect: true,
          deletedAt: true,
          _count: { select: { portfolios: true } },
        },
      });
      if (!broker?.deletedAt) return { ok: false, chyba: "Tenhle broker v koši není." };

      if (broker._count.portfolios > 0) {
        return {
          ok: false,
          chyba: `${broker.name} je použitý u ${pocet(broker._count.portfolios, "portfolia", "portfolií", "portfolií")}. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      // Objednávky se tu odbavovat nemusí: broker se u objednávky vede
      // od 22. 9. 2026 vůbec, takže ji nic nedrží.

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "broker",
          entityId: id,
          action: "broker.smazan",
          before: { name: broker.name, autoConnect: broker.autoConnect },
        });
        await tx.broker.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${broker.name}.` };
    }

    case "uzivatel": {
      const uzivatel = await db.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          deletedAt: true,
          _count: {
            select: { calls: true, tasks: true, auditLog: true, events: true },
          },
        },
      });
      if (!uzivatel?.deletedAt) return { ok: false, chyba: "Tenhle účet v koši není." };

      if (uzivatel.id === admin.id) return { ok: false, chyba: "Vlastní účet smazat nemůžeš." };

      // Aktivita se počítá do historie: kdo se přihlásil a díval se na
      // klienty, po sobě stopu nechal. Nadobro jde smazat jen účet, který
      // se nikdy nepřihlásil — typicky překlep v e-mailu.
      const { calls, tasks, auditLog, events } = uzivatel._count;
      if (calls > 0 || tasks > 0 || auditLog > 0 || events > 0) {
        return {
          ok: false,
          chyba: `${uzivatel.name} po sobě v systému něco nechal. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "users",
          entityId: id,
          action: "uzivatel.smazan",
          before: { name: uzivatel.name, email: uzivatel.email, role: uzivatel.role },
        });
        await tx.user.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${uzivatel.name}.` };
    }
  }
}
