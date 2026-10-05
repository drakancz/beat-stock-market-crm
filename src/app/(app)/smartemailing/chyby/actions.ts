"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { jdeZnovuSpustit, vyresChybu, type DruhChyby } from "@/lib/chyby";
import { db } from "@/lib/db";
import { posliUvitani, posliZkusebniEmail } from "@/lib/email";
import { znovuOdkazKlientovi } from "@/lib/klient/pozvanka";
import { osloveniUzivatele } from "@/lib/osloveni";
import { requireAdmin } from "@/lib/session";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  POPIS_DUVODU_NEODESLANI,
  odhlasKlientaZnovu,
  odesliZnovu,
} from "@/lib/smartemailing";
import { odeberSouhlasOdhlasenym } from "@/lib/smartemailing-synchronizace";

import { novyOdkazNaHeslo } from "../../sprava/uzivatele/actions";

/**
 * SmartEmailing → Chyby — Znovu spustit a Uzavřít. **Jen administrátor** (Jakub,
 * 15. 9. 2026); každá akce si `requireAdmin()` volá sama.
 *
 * Znovu spustit posílá **aktuální údaje z CRM**, obsah původního požadavku
 * se neukládá. Když opakování projde, chyba se vyřeší; když selže znovu,
 * u téže chyby přibude pokus. Obojí jde do auditu.
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const idChyby = z.string().trim().min(1).max(64);

/** Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu. */
function zaloguj(co: string, chyba: unknown) {
  console.error(`Chyby: ${co} selhalo:`, chyba instanceof Error ? chyba.name : "neznámá chyba");
}

function obnovStranky(clientId: string | null) {
  revalidatePath("/smartemailing/chyby");
  revalidatePath("/smartemailing");
  if (clientId) revalidatePath(`/klienti/${clientId}`);
}

/** Samotné opakování podle druhu chyby. */
async function spust(
  druh: DruhChyby,
  chyba: { clientId: string | null; userId: string | null },
  adminId: string,
): Promise<Vysledek> {
  switch (druh) {
    case "smartemailing.klient": {
      if (!chyba.clientId) return { ok: false, chyba: "Klient už v systému není — chybu uzavři." };

      const vysledek = await odesliZnovu(chyba.clientId, adminId);
      switch (vysledek.stav) {
        case "odeslano":
          return { ok: true, zprava: "Klient odešel do SmartEmailingu." };
        case "chyba":
          return {
            ok: false,
            chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}. Chyba zůstává v seznamu.`,
          };
        case "vypnuto":
          return {
            ok: false,
            chyba: "Propojení se SmartEmailingem je vypnuté nebo nemá vybraný seznam.",
          };
        case "nelze":
          return {
            ok: true,
            zprava: `${POPIS_DUVODU_NEODESLANI[vysledek.duvod]} Nic se neodeslalo a chyba je uzavřená.`,
          };
        case "vyreseno":
          return { ok: true, zprava: "Klient mezitím odešel, chyba je vyřešená." };
      }
      break;
    }

    case "smartemailing.odhlaseni-klienta": {
      if (!chyba.clientId) return { ok: false, chyba: "Klient už v systému není — chybu uzavři." };

      const vysledek = await odhlasKlientaZnovu(chyba.clientId, adminId);
      switch (vysledek) {
        case "odhlaseno":
          return { ok: true, zprava: "Klient je ve SmartEmailingu odhlášený." };
        case "ma-souhlas":
          return {
            ok: false,
            chyba:
              "Klient má v CRM souhlas, není co odhlašovat. Šlo-li o starou adresu po změně e-mailu, odhlas ji ve SmartEmailingu ručně a chybu uzavři.",
          };
        case "neni":
          return { ok: false, chyba: "Klient už v systému není — chybu uzavři." };
        case "vypnuto":
          return {
            ok: false,
            chyba: "Propojení se SmartEmailingem je vypnuté nebo nemá vybraný seznam.",
          };
        default:
          return {
            ok: false,
            chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek]}. Chyba zůstává v seznamu.`,
          };
      }
    }

    case "smartemailing.odhlaseni": {
      const vysledek = await odeberSouhlasOdhlasenym(adminId);
      if (vysledek.ok) {
        return {
          ok: true,
          zprava: `Odhlášené jsou načtené. Souhlas odebrán klientům: ${vysledek.odebrano}.`,
        };
      }
      return {
        ok: false,
        chyba:
          vysledek.chyba === "bez-seznamu"
            ? "V Nastavení propojení není vybraný seznam."
            : `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}.`,
      };
    }

    case "email.pozvanka":
    case "email.obnova-hesla": {
      if (!chyba.userId) return { ok: false, chyba: "Uživatel už v systému není — chybu uzavři." };

      // Stejné jako tlačítko ve Správě: nový odkaz (starý přestane platit),
      // pozvánka nebo obnova hesla podle toho, jestli už heslo má.
      const vysledek = await novyOdkazNaHeslo(chyba.userId);
      if (!vysledek.ok) return vysledek;
      if ("odkaz" in vysledek && vysledek.odkaz) {
        return {
          ok: false,
          chyba:
            "E-mail se ani teď nepodařilo odeslat. Nový odkaz jde vydat a předat osobně ve Správě → Uživatelé.",
        };
      }
      return { ok: true, zprava: vysledek.zprava ?? "E-mail s novým odkazem znovu odešel." };
    }

    case "email.pozvanka-klienta":
    case "email.obnova-klienta": {
      if (!chyba.clientId) return { ok: false, chyba: "Klient už v systému není — chybu uzavři." };

      // Klient bez hesla dostane pozvánku znovu, s heslem nový odkaz.
      const vysledek = await znovuOdkazKlientovi(chyba.clientId, adminId);
      if (!vysledek.ok) return vysledek;
      if (vysledek.odkaz) {
        return {
          ok: false,
          chyba:
            "E-mail se ani teď nepodařilo odeslat. Odkaz jde vydat a předat osobně na kartě klienta.",
        };
      }
      return { ok: true, zprava: vysledek.zprava };
    }

    case "email.uvitani":
    case "email.zkusebni": {
      const uzivatel = chyba.userId
        ? await db.user.findFirst({
            where: { id: chyba.userId, deletedAt: null },
            select: { id: true, name: true, email: true, firstName: true, vocative: true },
          })
        : null;
      if (!uzivatel) return { ok: false, chyba: "Uživatel už v systému není — chybu uzavři." };

      const vstup = {
        komu: uzivatel.email,
        osloveni: osloveniUzivatele(uzivatel),
        userId: uzivatel.id,
        spustilId: adminId,
      };
      const posta =
        druh === "email.uvitani" ? await posliUvitani(vstup) : await posliZkusebniEmail(vstup);

      if (posta.odeslano) return { ok: true, zprava: `E-mail znovu odešel na ${uzivatel.email}.` };
      return {
        ok: false,
        chyba:
          posta.duvod === "nenastaveno"
            ? "Odesílání e-mailů není na serveru nastavené."
            : "E-mail se ani teď nepodařilo odeslat. Chyba zůstává v seznamu.",
      };
    }

    case "lead.odmitnut":
      return { ok: false, chyba: "Odmítnutý lead z webu znovu spustit nejde." };

    case "smartemailing.webhook":
      return {
        ok: false,
        chyba:
          "Zprávu ze SmartEmailingu znovu spustit nejde, obsah se neukládá. Odhlášené jde načíst tlačítkem v Synchronizaci kontaktů.",
      };

    case "email.upozorneni":
      return {
        ok: false,
        chyba: "Upozornění na chyby znovu spustit nejde — přijde samo s další chybou.",
      };
  }

  return { ok: false, chyba: "Neznámý druh chyby." };
}

/** Znovu spustí akci, která selhala — s aktuálními údaji z CRM. */
export async function znovuSpustitChybu(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = idChyby.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const chyba = await db.integrationError.findUnique({
    where: { id: id.data },
    select: { id: true, kind: true, clientId: true, userId: true, resolvedAt: true },
  });
  if (!chyba) return { ok: false, chyba: "Taková chyba neexistuje." };
  if (chyba.resolvedAt) return { ok: true, zprava: "Tahle chyba už je vyřešená." };
  if (!jdeZnovuSpustit(chyba.kind)) {
    return { ok: false, chyba: "Tuhle chybu znovu spustit nejde, jde jen uzavřít." };
  }

  const druh = chyba.kind as DruhChyby;

  await db.$transaction(async (tx) => {
    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "integration_errors",
      entityId: chyba.id,
      action: "chyba.znovu-spustena",
      after: { druh },
    });
  });

  let vysledek: Vysledek;
  try {
    vysledek = await spust(druh, chyba, admin.id);
  } catch (vyjimka) {
    zaloguj("opakování", vyjimka);
    vysledek = { ok: false, chyba: "Opakování se nepovedlo. Zkus to za chvíli znovu." };
  }

  // Úspěch vyřeší právě tuhle chybu — i když opakování vedlo k jinému druhu
  // zprávy (pozvánka u člověka, který si mezitím heslo nastavil).
  if (vysledek.ok) await vyresChybu(chyba.id, { zpusob: "vyreseno", kdoId: admin.id });

  obnovStranky(chyba.clientId);
  return vysledek;
}

/** Uzavře chybu bez opakování. */
export async function uzavritChybu(idRaw: string): Promise<Vysledek> {
  const admin = await requireAdmin();

  const id = idChyby.safeParse(idRaw);
  if (!id.success) return { ok: false, chyba: "Neplatný požadavek." };

  const chyba = await db.integrationError.findUnique({
    where: { id: id.data },
    select: { id: true, kind: true, clientId: true, resolvedAt: true },
  });
  if (!chyba) return { ok: false, chyba: "Taková chyba neexistuje." };
  if (chyba.resolvedAt) return { ok: true, zprava: "Tahle chyba už je vyřešená." };

  await db.$transaction(async (tx) => {
    await tx.integrationError.update({
      where: { id: chyba.id },
      data: { resolvedAt: new Date(), resolvedById: admin.id, resolution: "uzavreno" },
    });

    // U klienta zmizí i červený pruh na kartě — chyba je vyřízená.
    if (chyba.kind === "smartemailing.klient" && chyba.clientId) {
      await tx.client.update({
        where: { id: chyba.clientId },
        data: { smartemailingError: null, smartemailingErrorDetail: null },
      });
    }

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "integration_errors",
      entityId: chyba.id,
      action: "chyba.uzavrena",
      after: { druh: chyba.kind },
    });
  });

  obnovStranky(chyba.clientId);
  return { ok: true, zprava: "Chyba je uzavřená." };
}
