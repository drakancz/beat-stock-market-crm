"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { prepocitejOdmenu } from "@/lib/doporuceni";
import { stitekPoZaplaceni } from "@/lib/pravidla";
import { prepocitejPlatnost } from "@/lib/platnost";
import { requireAdmin } from "@/lib/session";
import { jeUkazkovyTym, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";

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
  revalidatePath("/produkty");
  revalidatePath("/produkty/slevove-kody");
  revalidatePath("/produkty/doporucitele");
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
  // Na účty týmu ukázkový účet nesahá (src/lib/ukazka.ts).
  if (druh === "uzivatel" && jeUkazkovyTym(admin.email)) {
    return { ok: false, chyba: VYPNUTO_V_UKAZCE };
  }

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
        // Vrácená zaplacená objednávka doporučiteli zase odměnu má (5A).
        await prepocitejOdmenu(tx, id, admin.id);
        // A pravidlo Zaplaceno → štítek (5D), když ho klient ještě nedostal.
        await stitekPoZaplaceni(tx, id);
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

    case "slevovy-kod": {
      const kod = await db.discountCode.findUnique({
        where: { id },
        select: { id: true, code: true, deletedAt: true },
      });
      if (!kod?.deletedAt) return { ok: false, chyba: "Tenhle slevový kód v koši není." };

      // Kód je jedinečný i proti smazaným, takže kolize s novým nehrozí.
      await db.$transaction(async (tx) => {
        await tx.discountCode.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "discount_codes",
          entityId: id,
          action: "slevovy-kod.obnoven",
          after: { code: kod.code },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `Slevový kód ${kod.code} zase platí.` };
    }

    case "doporucitel": {
      const doporucitel = await db.referrer.findUnique({
        where: { id },
        select: { id: true, name: true, deletedAt: true },
      });
      if (!doporucitel?.deletedAt) return { ok: false, chyba: "Tenhle doporučitel v koši není." };

      await db.$transaction(async (tx) => {
        await tx.referrer.update({ where: { id }, data: { deletedAt: null } });
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "referrers",
          entityId: id,
          action: "doporucitel.obnoven",
          after: { name: doporucitel.name },
        });
      });

      obnovStranky();
      return { ok: true, zprava: `${doporucitel.name} je zpátky mezi doporučiteli.` };
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
  // Na účty týmu ukázkový účet nesahá (src/lib/ukazka.ts).
  if (druh === "uzivatel" && jeUkazkovyTym(admin.email)) {
    return { ok: false, chyba: VYPNUTO_V_UKAZCE };
  }

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
              tasks: true,
              activities: true,
              orders: true,
              // Zprávy do klientské části (3A, 4. 10. 2026) jsou historie.
              zpravy: true,
              // Účast na webinářích (3C) je taky historie.
              ucastNaWebinarich: true,
              // Rezervace konzultací (5B, 19. 10. 2026) taky.
              rezervace: true,
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

      const { tasks, activities, orders, zpravy, ucastNaWebinarich, rezervace } = klient._count;
      if (
        tasks > 0 ||
        activities > 0 ||
        orders > 0 ||
        zpravy > 0 ||
        ucastNaWebinarich > 0 ||
        rezervace > 0
      ) {
        return {
          ok: false,
          chyba: `${klient.name} má v systému historii (objednávky, úkoly, zprávy, účast na webinářích nebo rezervace konzultací). Nadobro smazat nejde — v koši zůstat může.`,
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
          odmena: { select: { id: true } },
          _count: { select: { items: true } },
        },
      });
      if (!objednavka?.deletedAt) return { ok: false, chyba: "Tahle objednávka v koši není." };

      // Na objednávce v koši může viset jen vyplacená odměna doporučiteli
      // (nevyplacená zmizí už smazáním) — a ta je doklad o odeslaných penězích.
      if (objednavka.odmena) {
        return {
          ok: false,
          chyba: `Z objednávky ${objednavka.number} je vyplacená odměna doporučiteli. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      // Jinak se objednávka maže vždycky: objednané produkty
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

    case "produkt": {
      const produkt = await db.product.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          kind: true,
          deletedAt: true,
          _count: { select: { orders: true, platnosti: true, kurzy: true } },
        },
      });
      if (!produkt?.deletedAt) return { ok: false, chyba: "Tenhle produkt v koši není." };

      // Objednávky a platnost členství na produkt odkazují. Kdyby
      // zmizel, z historie by se ztratilo, co si klient koupil.
      const { orders, platnosti, kurzy } = produkt._count;
      if (orders > 0 || platnosti > 0 || kurzy > 0) {
        return {
          ok: false,
          chyba: `${produkt.name} je v objednávkách, platnosti členství nebo má obsah kurzu ve Vzdělávání. Nadobro smazat nejde — v koši zůstat může.`,
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

    case "slevovy-kod": {
      const kod = await db.discountCode.findUnique({
        where: { id },
        select: { id: true, code: true, deletedAt: true, _count: { select: { objednavky: true } } },
      });
      if (!kod?.deletedAt) return { ok: false, chyba: "Tenhle slevový kód v koši není." };

      // Objednávky na kód odkazují — z historie by se ztratilo, odkud je sleva.
      if (kod._count.objednavky > 0) {
        return {
          ok: false,
          chyba: `${kod.code} je u objednávek. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "discount_codes",
          entityId: id,
          action: "slevovy-kod.smazan",
          before: { code: kod.code },
        });
        await tx.discountCode.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${kod.code}.` };
    }

    case "doporucitel": {
      const doporucitel = await db.referrer.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          deletedAt: true,
          _count: { select: { kody: true, privedeni: true, objednavky: true, odmeny: true } },
        },
      });
      if (!doporucitel?.deletedAt) return { ok: false, chyba: "Tenhle doporučitel v koši není." };

      // Přivedení klienti a odměny jsou historie — kdo koho přivedl a komu
      // se co vyplatilo, se nesmí ztratit.
      const { kody, privedeni, objednavky, odmeny } = doporucitel._count;
      if (kody > 0 || privedeni > 0 || objednavky > 0 || odmeny > 0) {
        return {
          ok: false,
          chyba: `${doporucitel.name} má kódy, přivedené klienty nebo odměny. Nadobro smazat nejde — v koši zůstat může.`,
        };
      }

      await db.$transaction(async (tx) => {
        await zapisDoAuditu(tx, {
          userId: admin.id,
          entity: "referrers",
          entityId: id,
          action: "doporucitel.smazan",
          before: { name: doporucitel.name },
        });
        await tx.referrer.delete({ where: { id } });
      });

      obnovStranky();
      return { ok: true, zprava: `Nadobro smazáno: ${doporucitel.name}.` };
    }

    case "broker": {
      const broker = await db.broker.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          autoConnect: true,
          deletedAt: true,
        },
      });
      if (!broker?.deletedAt) return { ok: false, chyba: "Tenhle broker v koši není." };

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
            select: { tasks: true, auditLog: true, events: true },
          },
        },
      });
      if (!uzivatel?.deletedAt) return { ok: false, chyba: "Tenhle účet v koši není." };

      if (uzivatel.id === admin.id) return { ok: false, chyba: "Vlastní účet smazat nemůžeš." };

      // Aktivita se počítá do historie: kdo se přihlásil a díval se na
      // klienty, po sobě stopu nechal. Nadobro jde smazat jen účet, který
      // se nikdy nepřihlásil — typicky překlep v e-mailu.
      const { tasks, auditLog, events } = uzivatel._count;
      if (tasks > 0 || auditLog > 0 || events > 0) {
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
