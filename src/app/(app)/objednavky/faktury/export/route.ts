import { z } from "zod";

import { db } from "@/lib/db";
import { csvFaktur, pohodaXml } from "@/lib/faktury/export";
import { obdobiFaktur, VYBER_DOKLADU } from "@/lib/faktury/faktury";
import { nactiNastaveni } from "@/lib/nastaveni";
import { viditelneObjednavky } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export faktur a dobropisů za období pro účetnictví (19. 10. 2026):
 * `?format=csv|pohoda&od=…&do=…`. **Každý přihlášený** (tým faktury vidí).
 * Obsluha adresy nemá rám aplikace — přihlášení si kontroluje sama.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove) {
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });
  }

  const parametry = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = z.enum(["csv", "pohoda"]).safeParse(parametry.format);
  if (!format.success) return new Response("Neznámý formát.", { status: 400 });
  const obdobi = obdobiFaktur(parametry);

  const doklady = await db.invoice.findMany({
    where: {
      issuedAt: { gte: obdobi.od, lt: obdobi.doVcetne },
      order: viditelneObjednavky(viewer),
    },
    orderBy: [{ issuedAt: "asc" }, { number: "asc" }],
    select: VYBER_DOKLADU,
  });

  const nazev = `faktury-${parametry.od ?? "mesic"}`;
  if (format.data === "csv") {
    return new Response(csvFaktur(doklady), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nazev}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const { ico } = await nactiNastaveni();
  return new Response(pohodaXml(doklady, ico), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nazev}-pohoda.xml"`,
      "Cache-Control": "private, no-store",
    },
  });
}
