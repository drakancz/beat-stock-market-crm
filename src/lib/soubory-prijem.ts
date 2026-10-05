import { randomUUID } from "node:crypto";

import { UTApi } from "uploadthing/server";

import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import type { Viewer } from "@/lib/session";
import {
  bezpecnyNazev,
  jePovoleny,
  LIMIT_BAJTU,
  LIMIT_POPIS_LIDSKY,
  obsahSedi,
} from "@/lib/soubory-typy";
import { smazZUloziste, ulozDoS3 } from "@/lib/uloziste";
import type { AttachmentOwner } from "@/generated/prisma/enums";

/**
 * Převzetí nahraného souboru do CRM.
 *
 * **Proč to nedělá `onUploadComplete`** (Jakub narazil 21. 9. 2026):
 * UploadThing zapisuje přílohu ze své odpovědi „soubor je nahraný",
 * kterou zpracovává na pozadí až po odeslání odpovědi. `next dev`
 * takovou práci ukončí — obsluha se rozeběhla a umřela na prvním čekání,
 * takže se v CRM nikdy nic neobjevilo a formulář visel na „Nahrávám…".
 * Ověřeno i s `after()`; chová se stejně.
 *
 * Soubor proto přebírá **serverová akce, kterou zavolá prohlížeč**, až
 * je nahrávání hotové. Je to zároveň poctivější: běží to v obyčejném
 * požadavku, takže chybu je komu ukázat.
 *
 * **Prohlížeči se nevěří nic.** Přijde jen klíč souboru a název:
 *
 * - klíč se ověří tím, že se soubor **opravdu stáhne** z úložiště —
 *   cizí ani vymyšlený klíč nic nevrátí,
 * - velikost se bere z odpovědi úložiště, ne z požadavku,
 * - typ musí být na seznamu povolených **a zároveň** mu musí odpovídat
 *   skutečné první bajty souboru (security_warnings.md, pravidlo 11),
 * - oprávnění k záznamu si ověřuje volající akce.
 */

/** Kolik bajtů se čte na kontrolu obsahu. */
const KUS = 4096;

export type VysledekPrijmu = { ok: true; souborId: string } | { ok: false; duvod: string };

export async function prijmiSoubor(
  viewer: Viewer,
  vstup: { key: string; nazev: string; typ: string; ownerType: AttachmentOwner; ownerId: string },
): Promise<VysledekPrijmu> {
  const nazev = bezpecnyNazev(vstup.nazev);

  // Tentýž soubor už přebraný být může — prohlížeč akci zkusí znovu,
  // když se odpověď ztratí. Pak se jen vrátí, co vzniklo poprvé.
  const uz = await db.attachment.findUnique({
    where: { key: vstup.key },
    select: { id: true, ownerId: true, ownerType: true },
  });
  if (uz) {
    if (uz.ownerId !== vstup.ownerId || uz.ownerType !== vstup.ownerType)
      return { ok: false, duvod: "soubor už patří jinam" };
    return { ok: true, souborId: uz.id };
  }

  if (!jePovoleny(vstup.typ)) return await zahod(vstup.key, "tenhle typ souboru nahrát nejde");

  const stazeny = await stahniZacatek(vstup.key);
  if (!stazeny) return await zahod(vstup.key, "soubor se nepodařilo načíst z úložiště");
  if (stazeny.velikost === 0) return await zahod(vstup.key, "soubor je prázdný");
  if (stazeny.velikost > LIMIT_BAJTU)
    return await zahod(vstup.key, `soubor je větší než ${LIMIT_POPIS_LIDSKY}`);
  if (!obsahSedi(vstup.typ, stazeny.zacatek))
    return await zahod(vstup.key, "obsah souboru neodpovídá jeho příponě");

  // Zápis do auditu je součástí změny, ne doplněk (pravidlo 7).
  const soubor = await db.$transaction(async (tx) => {
    const vytvoreny = await tx.attachment.create({
      data: {
        key: vstup.key,
        name: nazev,
        mimeType: vstup.typ,
        size: stazeny.velikost,
        ownerType: vstup.ownerType,
        ownerId: vstup.ownerId,
        uploadedById: viewer.id,
      },
      select: { id: true },
    });

    await zapisDoAuditu(tx, {
      userId: viewer.id,
      entity: "attachments",
      entityId: vytvoreny.id,
      action: "soubor.nahran",
      after: {
        nazev,
        typ: vstup.typ,
        velikost: stazeny.velikost,
        uKoho: `${vstup.ownerType}:${vstup.ownerId}`,
      },
    });

    return vytvoreny;
  });

  return { ok: true, souborId: soubor.id };
}

/**
 * Soubor nahraný **přes náš server** do úložiště S3 (4. 10. 2026,
 * `POST /api/soubory`).
 *
 * Na rozdíl od UploadThingu jde soubor celý přes CRM, takže se zkontroluje
 * **dřív, než se kamkoli uloží** — podvržený soubor do úložiště vůbec
 * nedorazí. Typ musí být povolený a sedět s prvními bajty, prázdný ani
 * větší než limit se nepřijme. Oprávnění k záznamu ověřuje volající.
 */
export async function prijmiSouborDoS3(
  viewer: Viewer,
  vstup: {
    nazev: string;
    typ: string;
    obsah: Uint8Array;
    ownerType: AttachmentOwner;
    ownerId: string;
  },
): Promise<VysledekPrijmu> {
  const nazev = bezpecnyNazev(vstup.nazev);

  if (!jePovoleny(vstup.typ)) return { ok: false, duvod: "tenhle typ souboru nahrát nejde" };
  if (vstup.obsah.byteLength === 0) return { ok: false, duvod: "soubor je prázdný" };
  if (vstup.obsah.byteLength > LIMIT_BAJTU)
    return { ok: false, duvod: `soubor je větší než ${LIMIT_POPIS_LIDSKY}` };
  if (!obsahSedi(vstup.typ, vstup.obsah.subarray(0, KUS)))
    return { ok: false, duvod: "obsah souboru neodpovídá jeho příponě" };

  // Klíč je náhodný a nenese název souboru — v názvu bývá jméno klienta.
  const klic = `${vstup.ownerType.toLowerCase()}/${vstup.ownerId}/${randomUUID()}`;

  try {
    await ulozDoS3(klic, vstup.obsah, vstup.typ);
  } catch (chyba) {
    console.error(
      "Soubor se nepodařilo uložit do úložiště:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return { ok: false, duvod: "soubor se nepodařilo uložit do úložiště" };
  }

  try {
    const soubor = await db.$transaction(async (tx) => {
      const vytvoreny = await tx.attachment.create({
        data: {
          key: klic,
          storage: "S3",
          name: nazev,
          mimeType: vstup.typ,
          size: vstup.obsah.byteLength,
          ownerType: vstup.ownerType,
          ownerId: vstup.ownerId,
          uploadedById: viewer.id,
        },
        select: { id: true },
      });

      await zapisDoAuditu(tx, {
        userId: viewer.id,
        entity: "attachments",
        entityId: vytvoreny.id,
        action: "soubor.nahran",
        after: {
          nazev,
          typ: vstup.typ,
          velikost: vstup.obsah.byteLength,
          uKoho: `${vstup.ownerType}:${vstup.ownerId}`,
        },
      });

      return vytvoreny;
    });
    return { ok: true, souborId: soubor.id };
  } catch {
    // Bez záznamu v CRM nemá soubor v úložišti co dělat.
    await smazZUloziste("S3", klic).catch(() =>
      console.error("Nezapsaný soubor se nepodařilo smazat z úložiště."),
    );
    return { ok: false, duvod: "soubor se nepodařilo zapsat" };
  }
}

/**
 * Stáhne začátek souboru a jeho velikost.
 *
 * Bez hlavičky `Range` — u prázdného souboru na ni úložiště odpoví
 * `416 Range Not Satisfiable`. Čte se první kus ze streamu a zbytek se
 * zahodí, takže se u velkého souboru nestahuje celý.
 */
async function stahniZacatek(
  key: string,
): Promise<{ zacatek: Uint8Array; velikost: number } | null> {
  try {
    const { ufsUrl } = await new UTApi().generateSignedURL(key, { expiresIn: 60 });
    const odpoved = await fetch(ufsUrl);
    if (!odpoved.ok || !odpoved.body) return null;

    const velikost = Number(odpoved.headers.get("content-length") ?? 0);
    const ctecka = odpoved.body.getReader();
    try {
      const { value } = await ctecka.read();
      return { zacatek: (value ?? new Uint8Array()).slice(0, KUS), velikost };
    } finally {
      await ctecka.cancel();
    }
  } catch {
    // Do logu nejde klíč ani název souboru.
    console.error("Nahraný soubor se nepodařilo ověřit u úložiště.");
    return null;
  }
}

/** Odmítnutý soubor se u úložiště hned maže — ať tam osobní údaje nezůstávají. */
async function zahod(key: string, duvod: string): Promise<VysledekPrijmu> {
  try {
    await new UTApi().deleteFiles(key);
  } catch {
    console.error("Odmítnutý soubor se nepodařilo smazat z úložiště.");
  }
  return { ok: false, duvod };
}
