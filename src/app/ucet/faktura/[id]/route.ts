import { db } from "@/lib/db";
import { odpovedPdf, pdfDokladu, VYBER_DOKLADU } from "@/lib/faktury/faktury";
import { getKlient } from "@/lib/klient/sezeni";
import { idZAdresy } from "@/lib/parametry";

export const dynamic = "force-dynamic";

/**
 * Stažení faktury nebo dobropisu v klientské části (19. 10. 2026). **Jen
 * přihlášený klient a jen svůj doklad** — hledá se podle `clientId`
 * z přihlášení, cizí i neexistující vrací stejně 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/ucet/faktura/[id]">) {
  const klient = await getKlient();
  if (!klient) return new Response("Nepřihlášeno.", { status: 401 });

  const id = idZAdresy((await params).id);
  const doklad = id
    ? await db.invoice.findFirst({
        where: { id, order: { clientId: klient.clientId, deletedAt: null } },
        select: VYBER_DOKLADU,
      })
    : null;
  const pdf = doklad ? await pdfDokladu(doklad) : null;
  if (!doklad || !pdf) return new Response("Nenalezeno.", { status: 404 });
  return odpovedPdf(pdf, doklad.number);
}
