import { db } from "@/lib/db";
import { odpovedPdf, pdfDokladu, VYBER_DOKLADU } from "@/lib/faktury/faktury";
import { idZAdresy } from "@/lib/parametry";
import { viditelneObjednavky } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Stažení faktury nebo dobropisu v PDF z CRM (19. 10. 2026). **Každý
 * přihlášený** (Jakub: tým faktury vidí), doklad se hledá přes viditelnost
 * objednávky. Obsluha adresy nemá rám aplikace — přihlášení a dvoufázové
 * ověření si kontroluje sama.
 */
export async function GET(_request: Request, { params }: RouteContext<"/objednavky/faktura/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove) {
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });
  }

  const id = idZAdresy((await params).id);
  const doklad = id
    ? await db.invoice.findFirst({
        where: { id, order: viditelneObjednavky(viewer) },
        select: VYBER_DOKLADU,
      })
    : null;
  const pdf = doklad ? await pdfDokladu(doklad) : null;
  if (!doklad || !pdf) return new Response("Nenalezeno.", { status: 404 });
  return odpovedPdf(pdf, doklad.number);
}
