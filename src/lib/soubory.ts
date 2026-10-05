import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";
import { kamNahravat } from "@/lib/uloziste";
import type { AttachmentOwner } from "@/generated/prisma/enums";

/**
 * Nahrané soubory (přílohy) — oprávnění a čtení z databáze.
 *
 * Jedno místo, kde je napsané **kdo smí soubory vidět, nahrát a smazat**.
 * Obrazovky ani obsluhy adres si podmínky nepíšou znovu (security.md,
 * pravidlo 3). Co se smí nahrát a jak velké to smí být, je v
 * `src/lib/soubory-typy.ts` — to platí i v prohlížeči.
 *
 * Soubory samotné leží v úložišti (`src/lib/uloziste.ts`), v naší databázi
 * je jen záznam s klíčem. **Klíč se nikdy neposílá do prohlížeče** —
 * soubor vydává `/api/soubory/[id]`, které napřed ověří přihlášení
 * a oprávnění.
 *
 * ### Vědomá výjimka (Jakub, 21. 9. 2026)
 *
 * Dokud nové soubory jdou k UploadThingu (free tarif), **nejde tam zapnout
 * soukromé soubory ani evropský region**. Adresa souboru je tedy veřejná
 * a data leží v USA; do příloh pak nepatří doklady ani smlouvy klientů —
 * rozhraní to u nahrávání říká. S úložištěm S3 (Cloudflare R2 v EU,
 * 4. 10. 2026) výjimka pro nové soubory odpadá. Podrobnosti v `security.md`.
 */

/**
 * Je nahrávání vůbec nastavené?
 *
 * Bez přístupu k úložišti se funkce tiše vypne a v rozhraní se neukáže
 * tlačítko Nahrát — nikdy se nedosazuje náhradní hodnota (security.md,
 * pravidlo 5).
 */
export function jeNahravaniZapnute(): boolean {
  return kamNahravat() !== null;
}

/**
 * Kdo smí u daného záznamu soubory **vidět**.
 *
 * Jakub, 21. 9. 2026: vidí je ten, kdo vidí samotný záznam.
 *
 * - **uživatel** — majitel profilu a administrátor; jinde se profil
 *   kolegy neukazuje (`/profil`, `/sprava/uzivatele/[id]`),
 * - **klient** — obchodník své klienty, manažer tým, administrátor vše.
 *   Rozhoduje o tom `viditelniKlienti()` z `queries.ts`, ne ručně psaná
 *   podmínka (security.md, pravidlo 3).
 */
export async function smiVidet(
  viewer: Viewer,
  ownerType: AttachmentOwner,
  ownerId: string,
): Promise<boolean> {
  switch (ownerType) {
    case "UZIVATEL": {
      if (viewer.id === ownerId) return true;
      if (viewer.role !== "ADMINISTRATOR") return false;
      // Administrátor jen u účtu, který v systému opravdu je. Účet
      // v koši se chová jako neexistující.
      const uzivatel = await db.user.findFirst({
        where: { id: ownerId, deletedAt: null },
        select: { id: true },
      });
      return uzivatel !== null;
    }
    case "KLIENT": {
      // Klient v koši i cizí klient se chovají stejně jako neexistující.
      const klient = await db.client.findFirst({
        where: { AND: [{ id: ownerId }, viditelniKlienti(viewer)] },
        select: { id: true },
      });
      return klient !== null;
    }
  }
}

/**
 * Kdo smí soubory **nahrávat**. Stejní lidé, kdo je vidí (Jakub,
 * 21. 9. 2026) — vlastní funkce je tu proto, aby se to u dalších druhů
 * záznamů dalo rozlišit, aniž by se to hledalo po celé aplikaci.
 */
export async function smiNahravat(
  viewer: Viewer,
  ownerType: AttachmentOwner,
  ownerId: string,
): Promise<boolean> {
  return smiVidet(viewer, ownerType, ownerId);
}

/**
 * Kdo smí soubor **smazat**: ten, kdo ho nahrál, a administrátor.
 * Stejné pravidlo jako u zápisu hovoru.
 */
export function smiSmazat(viewer: Viewer, soubor: { uploadedById: string }): boolean {
  return viewer.role === "ADMINISTRATOR" || soubor.uploadedById === viewer.id;
}

export interface SouborKZobrazeni {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  uploadedById: string;
  uploadedByName: string;
  smiSmazat: boolean;
}

/**
 * Soubory u jednoho záznamu, od nejnovějšího.
 *
 * **Oprávnění si volající ověřuje sám** (`smiVidet()`) — tahle funkce
 * jen čte. Klíč u UploadThingu se schválně nevrací; ven z databáze
 * nemá co chodit.
 */
export async function nactiSoubory(
  viewer: Viewer,
  ownerType: AttachmentOwner,
  ownerId: string,
): Promise<SouborKZobrazeni[]> {
  const soubory = await db.attachment.findMany({
    where: { ownerType, ownerId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      createdAt: true,
      uploadedById: true,
      uploadedBy: { select: { name: true } },
    },
  });

  return soubory.map((soubor) => ({
    id: soubor.id,
    name: soubor.name,
    mimeType: soubor.mimeType,
    size: soubor.size,
    createdAt: soubor.createdAt,
    uploadedById: soubor.uploadedById,
    uploadedByName: soubor.uploadedBy.name,
    smiSmazat: smiSmazat(viewer, soubor),
  }));
}
