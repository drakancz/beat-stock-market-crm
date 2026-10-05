"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { rozdilProAudit, zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";
import {
  POPIS_CHYBY_SMARTEMAILINGU,
  adresaWebhooku,
  hesloWebhooku,
  nactiSeznamyOdberatelu,
  overSpojeniSmartemailingu,
  smartemailingNastaveny,
  smazWebhook,
  zalozWebhookOdhlaseni,
} from "@/lib/smartemailing";

/**
 * SmartEmailing → Nastavení propojení. **Vidí i mění jen administrátor**
 * (Jakub, 13. 9. 2026). Nepřihlášený se k tomu nedostane — žádná veřejná
 * adresa nevzniká, CRM jen samo volá ven.
 *
 * Vybírá se tu, jestli se noví klienti posílají a do kterého seznamu.
 * Přihlašovací údaje se odsud **nenastavují ani nezobrazují**: jsou
 * v `.env` (security_warnings.md, pravidlo 3).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

const smartemailingSchema = z.object({
  zapnuto: z.boolean(),
  // Id seznamu je ve SmartEmailingu celé číslo. Prázdné = nic nevybráno.
  seznamId: z
    .string()
    .trim()
    .regex(/^\d{0,12}$/, "Vyber seznam odběratelů.")
    .transform((hodnota) => (hodnota === "" ? null : Number(hodnota))),
});

export async function ulozSmartemailing(formData: FormData): Promise<Vysledek> {
  const admin = await requireAdmin();

  const vstup = smartemailingSchema.safeParse({
    zapnuto: formData.get("smartemailingEnabled") === "on",
    seznamId: formData.get("smartemailingListId") ?? "",
  });
  if (!vstup.success) return { ok: false, chyba: vstup.error.issues[0]!.message };

  const { zapnuto, seznamId } = vstup.data;

  if (zapnuto && !smartemailingNastaveny()) {
    return { ok: false, chyba: "Na serveru chybí přihlašovací údaje ke SmartEmailingu." };
  }
  if (zapnuto && seznamId === null) {
    return { ok: false, chyba: "Bez vybraného seznamu propojení zapnout nejde." };
  }

  const puvodni = await nactiNastaveni();
  let nazevSeznamu = seznamId === null ? null : puvodni.smartemailingListName;

  // Nově vybraný seznam se ověří přímo ve SmartEmailingu — id z formuláře
  // mohl kdokoli přepsat a do neexistujícího seznamu by nic nedošlo.
  if (seznamId !== null && seznamId !== puvodni.smartemailingListId) {
    const seznamy = await nactiSeznamyOdberatelu();
    if (!seznamy.ok) {
      return {
        ok: false,
        chyba: `${POPIS_CHYBY_SMARTEMAILINGU[seznamy.chyba]}. Seznam teď nejde ověřit.`,
      };
    }

    const vybrany = seznamy.data.find((seznam) => seznam.id === seznamId);
    if (!vybrany) return { ok: false, chyba: "Vybraný seznam ve SmartEmailingu není." };
    nazevSeznamu = vybrany.name;
  }

  const nove = {
    smartemailingEnabled: zapnuto,
    smartemailingListId: seznamId,
    smartemailingListName: nazevSeznamu,
  };

  const rozdil = rozdilProAudit(
    {
      smartemailingEnabled: puvodni.smartemailingEnabled,
      smartemailingListId: puvodni.smartemailingListId,
    },
    { smartemailingEnabled: zapnuto, smartemailingListId: seznamId },
  );
  if (!rozdil) return { ok: true, zprava: "Nic se nezměnilo." };

  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: nove,
      create: { id: "firma", ...nove },
    });

    await zapisDoAuditu(tx, {
      userId: admin.id,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.smartemailing",
      ...rozdil,
    });
  });

  // Celá sekce — Synchronizace kontaktů ukazuje, jestli je propojení zapnuté.
  revalidatePath("/smartemailing", "layout");

  return {
    ok: true,
    zprava: zapnuto
      ? `Noví klienti se souhlasem půjdou do seznamu ${nazevSeznamu}.`
      : "Propojení je vypnuté, do SmartEmailingu nic neodchází.",
  };
}

/**
 * Uloží číslo webhooku (nebo jeho zrušení) a zapíše změnu do auditu. Heslo
 * webhooku ani adresa do auditu nejdou.
 */
async function ulozWebhook(adminId: string, puvodni: number | null, nove: number | null) {
  await db.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "firma" },
      update: { smartemailingWebhookId: nove },
      create: { id: "firma", smartemailingWebhookId: nove },
    });

    await zapisDoAuditu(tx, {
      userId: adminId,
      entity: "company_settings",
      entityId: "firma",
      action: "nastaveni.smartemailing-webhook",
      before: { prijemOdhlaseni: puvodni !== null, webhook: puvodni },
      after: { prijemOdhlaseni: nove !== null, webhook: nove },
    });
  });

  revalidatePath("/smartemailing", "layout");
}

/**
 * Zapne příjem odhlášení — založí ve SmartEmailingu webhook, který při
 * odhlášení kontaktu zavolá CRM (Jakub, 15. 9. 2026). **Jen administrátor.**
 * Když už příjem běží, založí webhook znovu (třeba po změně hesla v `.env`
 * nebo když ho SmartEmailing po chybách vypnul) a starý smaže.
 */
export async function zapniPrijemOdhlaseni(): Promise<Vysledek> {
  const admin = await requireAdmin();

  if (!smartemailingNastaveny()) {
    return { ok: false, chyba: "Na serveru chybí přihlašovací údaje ke SmartEmailingu." };
  }
  if (!hesloWebhooku()) {
    return { ok: false, chyba: "V .env chybí SMARTEMAILING_WEBHOOK_SECRET (aspoň 32 znaků)." };
  }
  const adresa = adresaWebhooku();
  if (!adresa.ok) {
    return { ok: false, chyba: `${adresa.duvod} Příjem odhlášení půjde zapnout po nasazení.` };
  }

  const puvodni = await nactiNastaveni();
  if (puvodni.smartemailingListId === null) {
    return { ok: false, chyba: "Nejdřív vyber a ulož seznam odběratelů." };
  }

  const vysledek = await zalozWebhookOdhlaseni();
  if (!vysledek.ok) {
    return {
      ok: false,
      chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}. Příjem odhlášení se nezapnul.`,
    };
  }

  // Dřívější webhook s jiným číslem (třeba na starou adresu aplikace) by
  // posílal zprávy dál — smaže se. Když to nevyjde, nový už běží, takže
  // se to jen nahlásí.
  let varovani = "";
  const stary = puvodni.smartemailingWebhookId;
  if (stary !== null && stary !== vysledek.data) {
    const smazani = await smazWebhook(stary);
    if (!smazani.ok) {
      varovani = ` Starší webhook č. ${stary} se nepodařilo smazat, smaž ho ve SmartEmailingu ručně.`;
    }
  }

  await ulozWebhook(admin.id, stary, vysledek.data);

  return {
    ok: true,
    zprava: `Příjem odhlášení je zapnutý, SmartEmailing bude odhlášené posílat hned.${varovani}`,
  };
}

/** Vypne příjem odhlášení — smaže webhook ve SmartEmailingu. **Jen administrátor.** */
export async function vypniPrijemOdhlaseni(): Promise<Vysledek> {
  const admin = await requireAdmin();

  const puvodni = await nactiNastaveni();
  const id = puvodni.smartemailingWebhookId;
  if (id === null) return { ok: true, zprava: "Příjem odhlášení už je vypnutý." };

  const vysledek = await smazWebhook(id);
  if (!vysledek.ok) {
    return {
      ok: false,
      chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}. Webhook se nepodařilo smazat, příjem zůstává zapnutý.`,
    };
  }

  await ulozWebhook(admin.id, id, null);

  return { ok: true, zprava: "Příjem odhlášení je vypnutý, webhook ve SmartEmailingu je smazaný." };
}

/** Zkouška, jestli SmartEmailing přijme přihlašovací údaje z `.env`. */
export async function vyzkousejSpojeni(): Promise<Vysledek> {
  await requireAdmin();

  const vysledek = await overSpojeniSmartemailingu();
  if (vysledek.ok) return { ok: true, zprava: "Spojení funguje, SmartEmailing údaje přijal." };

  return { ok: false, chyba: `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}.` };
}
