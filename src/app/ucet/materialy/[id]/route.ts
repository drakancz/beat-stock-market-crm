import { db } from "@/lib/db";
import { getKlient } from "@/lib/klient/sezeni";
import { idZAdresy } from "@/lib/parametry";
import { otevriteVOkne } from "@/lib/soubory-typy";
import { stahniSoubor } from "@/lib/uloziste";
import { nactiLekciKlienta } from "@/lib/vzdelavani/klient";

export const dynamic = "force-dynamic";

/**
 * Stažení materiálu u lekce v klientské části (Jakub, 3. 11. 2026).
 *
 * **Kdo sem smí:** jen přihlášený klient, který lekci smí otevřít —
 * zaplacený kurz a lekce, která už není zamčená. Rozhoduje o tom
 * `nactiLekciKlienta()`, stejná funkce jako u stránky lekce
 * (docs/funkce/vzdelavani.md), takže pravidla přístupu nejsou napsaná
 * podruhé. Cizí, zamčená i neexistující lekce vrací stejně 404.
 * Nepřihlášený dostane 401.
 *
 * Soubor teče přes náš server ze soukromého úložiště S3 (R2); adresa
 * v úložišti se do prohlížeče nedostane. Materiály u UploadThingu se
 * nevydávají vůbec — nahrát se tam ani nedají.
 *
 * Obsluha adresy nemá rám klientské části, proto si přihlášení ověřuje
 * sama (`getKlient()`, bez přesměrování).
 */
export async function GET(_request: Request, { params }: RouteContext<"/ucet/materialy/[id]">) {
  const klient = await getKlient();
  if (!klient) return new Response("Nepřihlášeno.", { status: 401 });

  const id = idZAdresy((await params).id);
  const soubor = id
    ? await db.attachment.findFirst({
        where: { id, ownerType: "LEKCE", storage: "S3", deletedAt: null },
        select: { key: true, name: true, mimeType: true, ownerId: true },
      })
    : null;
  if (!soubor) return new Response("Nenalezeno.", { status: 404 });

  // Přístup k lekci — clientId vždy z přihlášení, nikdy z adresy.
  const lekce = await nactiLekciKlienta(klient.clientId, soubor.ownerId);
  if (!lekce) return new Response("Nenalezeno.", { status: 404 });

  const stazeny = await stahniSoubor("S3", soubor.key);
  if (!stazeny) return new Response("Soubor se nepodařilo načíst.", { status: 502 });

  const vOkne = otevriteVOkne(soubor.mimeType);

  return new Response(stazeny.telo, {
    headers: {
      // Typ z databáze, kde je ověřený podle obsahu souboru.
      "Content-Type": soubor.mimeType,
      "Content-Disposition": `${vOkne ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(soubor.name)}`,
      ...(stazeny.velikost !== null ? { "Content-Length": String(stazeny.velikost) } : {}),
      "X-Content-Type-Options": "nosniff",
      // Klientská část soubor do rámu nevkládá — otevírá se v nové záložce.
      "X-Frame-Options": "DENY",
      ...(vOkne ? {} : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
      "Cache-Control": "private, no-store",
    },
  });
}
