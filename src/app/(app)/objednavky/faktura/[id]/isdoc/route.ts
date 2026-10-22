import { db } from "@/lib/db";
import { isdocXml } from "@/lib/faktury/export";
import { VYBER_DOKLADU } from "@/lib/faktury/faktury";
import { idZAdresy } from "@/lib/parametry";
import { viditelneObjednavky } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Faktura nebo dobropis ve formátu ISDOC (19. 10. 2026) — elektronická
 * faktura pro účetní programy. **Každý přihlášený**, přes viditelnost
 * objednávky.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/objednavky/faktura/[id]/isdoc">,
) {
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
  if (!doklad) return new Response("Nenalezeno.", { status: 404 });

  return new Response(isdocXml(doklad), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${doklad.number}.isdoc"`,
      "Cache-Control": "private, no-store",
    },
  });
}
