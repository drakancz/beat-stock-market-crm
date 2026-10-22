import { db } from "@/lib/db";
import { getKlient } from "@/lib/klient/sezeni";
import { nactiNastaveni } from "@/lib/nastaveni";
import { idZAdresy } from "@/lib/parametry";
import { vytvorPdfCertifikatu } from "@/lib/vzdelavani/certifikat-pdf";

export const dynamic = "force-dynamic";

/**
 * Stažení certifikátu o absolvování kurzu v PDF (Fáze 5C, 11. 10. 2026).
 *
 * **Jen přihlášený klient a jen svůj certifikát** — hledá se podle
 * `clientId` z přihlášení. Cizí i neexistující certifikát vrací stejně
 * 404. Tým certifikát v CRM jen vidí (číslo a datum), stáhnout ho nemá
 * (Jakub, 11. 10. 2026). Veřejné ověření pravosti zatím není.
 *
 * Obsluha adresy nemá rám klientské části, proto si přihlášení ověřuje
 * sama (`getKlient()`, bez přesměrování — 401).
 */
export async function GET(_request: Request, { params }: RouteContext<"/ucet/certifikat/[id]">) {
  const klient = await getKlient();
  if (!klient) return new Response("Nepřihlášeno.", { status: 401 });

  const id = idZAdresy((await params).id);
  const certifikat = id
    ? await db.courseCertificate.findFirst({
        where: { id, clientId: klient.clientId },
        select: { number: true, clientName: true, courseTitle: true, issuedAt: true },
      })
    : null;
  if (!certifikat) return new Response("Nenalezeno.", { status: 404 });

  const { companyName } = await nactiNastaveni();
  const pdf = await vytvorPdfCertifikatu({
    cislo: certifikat.number,
    jmeno: certifikat.clientName,
    kurz: certifikat.courseTitle,
    vydano: certifikat.issuedAt,
    firma: companyName,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certifikat-${certifikat.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
