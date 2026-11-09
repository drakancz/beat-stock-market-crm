import { z } from "zod";

import { jeCiziPuvod } from "@/lib/puvod";
import { getViewer } from "@/lib/session";
import { smiNahravat } from "@/lib/soubory";
import { prijmiSouborDoS3 } from "@/lib/soubory-prijem";
import { LIMIT_BAJTU } from "@/lib/soubory-typy";
import { kamNahravat } from "@/lib/uloziste";
import { odpovedJson as odpoved } from "@/lib/verejne-api";

/**
 * Nahrání přílohy do úložiště S3 — `POST /api/soubory?typ=KLIENT&id=…`
 * (4. 10. 2026; na serveru Cloudflare R2 v EU, ve vývoji S3Mock).
 *
 * **Kdo sem smí:** přihlášený s dvoufázovým ověřením, kdo smí u daného
 * záznamu nahrávat (`smiNahravat()` — stejní lidé jako dnes u UploadThingu).
 * Nepovolaný dostane 404.
 *
 * Tělo požadavku je **samotný soubor**, typ v `Content-Type`, název
 * v hlavičce `X-Nazev` (zakódovaný jako v adrese). Soubor jde celý přes
 * náš server, takže se zkontroluje dřív, než se uloží
 * (`prijmiSouborDoS3()`) — prohlížeč se k úložišti nedostane vůbec.
 *
 * Proti podvrženému odeslání z cizí stránky: cookie se sezením je
 * `SameSite=Lax` (cizí stránka ji s `POST` nepošle), vlastní hlavička
 * `X-Nazev` vynutí u cizího původu kontrolu prohlížeče, a hlavička
 * `Origin`, když přijde, musí být naše.
 */

export const dynamic = "force-dynamic";

const parametry = z.object({
  // LEKCE = materiál ke stažení u lekce (3. 11. 2026) — jen sem, do S3,
  // nikdy přes UploadThing (`/api/uploadthing` ho nepřijme).
  typ: z.enum(["UZIVATEL", "KLIENT", "LEKCE"]),
  id: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return odpoved(401, { ok: false, chyba: "Nepřihlášeno." });
  if (viewer.chybiDvoufazove) {
    return odpoved(403, { ok: false, chyba: "Nejdřív si zapni dvoufázové ověření." });
  }

  if (jeCiziPuvod(request)) {
    return odpoved(403, { ok: false, chyba: "Požadavek z cizí stránky." });
  }

  const adresa = new URL(request.url);
  const vstup = parametry.safeParse({
    typ: adresa.searchParams.get("typ"),
    id: adresa.searchParams.get("id"),
  });
  if (!vstup.success) return odpoved(404, { ok: false, chyba: "Nenalezeno." });

  if (!(await smiNahravat(viewer, vstup.data.typ, vstup.data.id))) {
    return odpoved(404, { ok: false, chyba: "Nenalezeno." });
  }

  if (kamNahravat() !== "S3") {
    return odpoved(503, { ok: false, chyba: "Úložiště souborů není nastavené." });
  }

  // Velikost se hlídá dvakrát: podle hlavičky ještě před čtením a podle
  // skutečně přečtených bajtů — hlavička může lhát.
  const deklarovana = Number(request.headers.get("content-length") ?? "0");
  if (deklarovana > LIMIT_BAJTU) {
    return odpoved(413, { ok: false, chyba: "Soubor je větší než 25 MB." });
  }

  let nazev: string;
  try {
    nazev = decodeURIComponent(request.headers.get("x-nazev") ?? "");
  } catch {
    return odpoved(400, { ok: false, chyba: "Neplatný název souboru." });
  }
  const typSouboru = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!nazev || nazev.length > 300 || !typSouboru || typSouboru.length > 160) {
    return odpoved(400, { ok: false, chyba: "Chybí název nebo typ souboru." });
  }

  const obsah = new Uint8Array(await request.arrayBuffer());
  if (obsah.byteLength > LIMIT_BAJTU) {
    return odpoved(413, { ok: false, chyba: "Soubor je větší než 25 MB." });
  }

  const vysledek = await prijmiSouborDoS3(viewer, {
    nazev,
    typ: typSouboru,
    obsah,
    ownerType: vstup.data.typ,
    ownerId: vstup.data.id,
  });

  if (!vysledek.ok) {
    return odpoved(400, { ok: false, chyba: `Soubor nebyl přijat — ${vysledek.duvod}.` });
  }
  return odpoved(201, { ok: true, id: vysledek.souborId });
}
