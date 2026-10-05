import { db } from "@/lib/db";
import { idZAdresy } from "@/lib/parametry";
import { getViewer } from "@/lib/session";
import { smiVidet } from "@/lib/soubory";
import { otevriteVOkne } from "@/lib/soubory-typy";
import { jeUlozisteDostupne, stahniSoubor } from "@/lib/uloziste";

/**
 * Výdej nahraného souboru.
 *
 * **Soubor teče přes naše CRM** (Jakub, 21. 9. 2026). Prohlížeč nikdy
 * nedostane adresu u úložiště — dostane tuhle, a teprve když projde
 * přihlášením a oprávněním, náš server soubor stáhne a přepošle dál.
 * Zkopírovaný odkaz je tak cizímu k ničemu: bez přihlášení vrátí 404.
 *
 * Dokud je účet u UploadThingu na free tarifu, **existuje u nich i tak
 * veřejná adresa** (soukromé soubory jsou až od placeného tarifu, viz
 * `security.md`). Zná ji jen náš server; nikam ji nevydáváme. Po
 * přechodu na placený tarif se tady jen vymění způsob stažení za
 * podepsanou adresu — v aplikaci se nemění nic.
 *
 * Obsluha adresy nemá rám aplikace, takže si přihlášení i dvoufázové
 * ověření kontroluje sama (security.md, pravidlo 1).
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/soubory/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove)
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });

  const id = idZAdresy((await params).id);
  if (!id) return new Response("Nenalezeno.", { status: 404 });

  const soubor = await db.attachment.findFirst({
    where: { id, deletedAt: null },
    select: {
      key: true,
      storage: true,
      name: true,
      mimeType: true,
      ownerType: true,
      ownerId: true,
    },
  });
  if (!soubor) return new Response("Nenalezeno.", { status: 404 });

  // Nepovolaný dostane 404, ne „nemáte oprávnění" — z odpovědi se nemá
  // dát vyčíst, co v systému existuje.
  if (!(await smiVidet(viewer, soubor.ownerType, soubor.ownerId)))
    return new Response("Nenalezeno.", { status: 404 });

  // Úložiště, kde soubor leží (S3, nebo starší UploadThing — 4. 10. 2026).
  if (!jeUlozisteDostupne(soubor.storage))
    return new Response("Nahrávání souborů není nastavené.", { status: 503 });

  // Do hlášky ani do logu nejde název souboru — bývá v něm jméno.
  const stazeny = await stahniSoubor(soubor.storage, soubor.key);
  if (!stazeny) return new Response("Soubor se nepodařilo načíst.", { status: 502 });

  const vOkne = otevriteVOkne(soubor.mimeType);

  return new Response(stazeny.telo, {
    headers: {
      // Typ se bere z databáze, kde je ověřený, ne z odpovědi úložiště.
      "Content-Type": soubor.mimeType,
      "Content-Disposition": `${vOkne ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(soubor.name)}`,
      ...(stazeny.velikost !== null ? { "Content-Length": String(stazeny.velikost) } : {}),
      // Prohlížeč si nesmí typ domýšlet podle obsahu — jinak by šlo
      // z textového souboru udělat stránku se skriptem na naší adrese.
      "X-Content-Type-Options": "nosniff",
      /*
       * Náhled v okně CRM (Jakub, 21. 9. 2026).
       *
       * U souborů, které se **jen stahují**, zůstává nejpřísnější
       * nastavení: nic se nesmí načíst, nic vložit do rámu, izolace
       * `sandbox`.
       *
       * U souborů, které se **ukazují v náhledu**, se tu vlastní
       * Content-Security-Policy neposílá — platí jen celoaplikační
       * `frame-ancestors 'self'` z `next.config.ts`. Přísnější nastavení
       * (`default-src 'none'`) **rozbilo vestavěnou čtečku PDF**: okno
       * se otevřelo, ale zůstalo prázdné (Jakub to 21. 9. 2026 zkusil).
       * Na skripty uvnitř souboru je zábrana jinde — HTML ani SVG se
       * nahrát nedají, typ se bere z databáze a `nosniff` brání jeho
       * záměně.
       */
      ...(vOkne
        ? { "X-Frame-Options": "SAMEORIGIN" }
        : {
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
            "X-Frame-Options": "DENY",
          }),
      // Soubor s osobními údaji nemá co ležet v mezipaměti na cestě
      // (security_warnings.md, pravidlo 8).
      "Cache-Control": "private, no-store",
    },
  });
}
