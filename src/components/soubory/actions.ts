"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/session";
import { smiNahravat, smiSmazat, smiVidet } from "@/lib/soubory";
import { prijmiSoubor } from "@/lib/soubory-prijem";
import { jeUlozisteDostupne, smazZUloziste } from "@/lib/uloziste";
import type { AttachmentOwner } from "@/generated/prisma/enums";

/**
 * Akce nad nahranými soubory.
 *
 * Soubor se **maže doopravdy** — u UploadThingu i ze seznamu. Osobní
 * údaje nemají zůstávat u cizí firmy déle, než je potřeba
 * (security_warnings.md, pravidlo 8). Řádek v databázi zůstane
 * s vyplněným `deletedAt` jako stopa, že tu soubor byl; obnovit ho ale
 * nejde a do obrazovky Smazané se přílohy proto nedávají (Jakub,
 * 21. 9. 2026). Potvrzovací okno to říká dopředu.
 */

const smazatSchema = z.object({ id: z.string().trim().min(1).max(64) });

export type VysledekAkce = { ok: true } | { ok: false; chyba: string };

/**
 * Převzetí právě nahraného souboru.
 *
 * Volá ji formulář, jakmile nahrávání k úložišti doběhne. Všechno, co
 * přijde z prohlížeče, se ověřuje — klíč tím, že se soubor opravdu
 * stáhne, velikost z odpovědi úložiště a typ podle skutečných bajtů
 * (podrobně v `src/lib/soubory-prijem.ts`).
 */
const prijemSchema = z.object({
  key: z.string().trim().min(1).max(256),
  nazev: z.string().trim().min(1).max(300),
  typ: z.string().trim().min(1).max(160),
  ownerType: z.enum(["UZIVATEL", "KLIENT"]),
  ownerId: z.string().trim().min(1).max(64),
});

export async function prevezmiSoubor(vstup: {
  key: string;
  nazev: string;
  typ: string;
  ownerType: string;
  ownerId: string;
}): Promise<VysledekAkce> {
  const viewer = await requireViewer();

  const data = prijemSchema.safeParse(vstup);
  if (!data.success) return { ok: false, chyba: "Soubor se nepodařilo přijmout." };

  if (!(await smiNahravat(viewer, data.data.ownerType, data.data.ownerId)))
    return { ok: false, chyba: "Sem soubory nahrávat nemůžeš." };

  const vysledek = await prijmiSoubor(viewer, {
    key: data.data.key,
    nazev: data.data.nazev,
    typ: data.data.typ,
    ownerType: data.data.ownerType,
    ownerId: data.data.ownerId,
  });

  if (!vysledek.ok) return { ok: false, chyba: `Soubor nebyl přijat — ${vysledek.duvod}.` };

  prekresliObrazovky(data.data.ownerType, data.data.ownerId);
  return { ok: true };
}

/**
 * Seznam příloh je součástí obrazovky, na které visí — po změně se musí
 * překreslit. Které to jsou, se řídí druhem záznamu; u uživatele jsou
 * dvě (vlastní profil a profil kolegy ve Správě).
 */
function prekresliObrazovky(ownerType: AttachmentOwner, ownerId: string) {
  switch (ownerType) {
    case "UZIVATEL":
      revalidatePath("/profil");
      revalidatePath(`/sprava/uzivatele/${ownerId}`);
      return;
    case "KLIENT":
      revalidatePath(`/klienti/${ownerId}`);
      return;
  }
}

export async function smazSoubor(id: string): Promise<VysledekAkce> {
  const viewer = await requireViewer();

  // I hodnota, která je v TypeScriptu `string`, se ověřuje — prohlížeč
  // může serverové akci poslat cokoli (security.md, pravidlo 4).
  const vstup = smazatSchema.safeParse({ id });
  if (!vstup.success) return { ok: false, chyba: "Soubor se nepodařilo najít." };

  const soubor = await db.attachment.findFirst({
    where: { id: vstup.data.id, deletedAt: null },
    select: {
      id: true,
      key: true,
      storage: true,
      name: true,
      ownerType: true,
      ownerId: true,
      uploadedById: true,
    },
  });
  // Neexistující i cizí soubor se chovají stejně — z odpovědi se nemá
  // dát vyčíst, co v systému je.
  if (!soubor) return { ok: false, chyba: "Soubor se nepodařilo najít." };

  if (!(await smiVidet(viewer, soubor.ownerType, soubor.ownerId)))
    return { ok: false, chyba: "Soubor se nepodařilo najít." };
  if (!smiSmazat(viewer, soubor))
    return { ok: false, chyba: "Smazat soubor smí jen ten, kdo ho nahrál, a administrátor." };

  if (!jeUlozisteDostupne(soubor.storage))
    return { ok: false, chyba: "Nahrávání souborů není nastavené, soubor smazat nejde." };

  // Napřed u úložiště: kdyby to selhalo, ať v CRM nezůstane záznam
  // o souboru, který ve skutečnosti pořád leží u cizí firmy.
  try {
    await smazZUloziste(soubor.storage, soubor.key);
  } catch {
    // Do logu nejde název souboru ani klíč.
    console.error("Soubor se nepodařilo smazat z úložiště.");
    return { ok: false, chyba: "Soubor se nepodařilo smazat z úložiště. Zkus to prosím znovu." };
  }

  await db.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id: soubor.id },
      data: { deletedAt: new Date() },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "attachments",
      entityId: soubor.id,
      action: "soubor.smazan",
      before: { nazev: soubor.name, uKoho: `${soubor.ownerType}:${soubor.ownerId}` },
    });
  });

  prekresliObrazovky(soubor.ownerType, soubor.ownerId);

  return { ok: true };
}
