import { z } from "zod";

import { sestavCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { formatDatum, formatTelefon } from "@/lib/format";
import { jakoDen } from "@/lib/obdobi";
import { jeCiziPuvod } from "@/lib/puvod";
import { viditelniKlienti } from "@/lib/queries";
import { getViewer } from "@/lib/session";
import { MAX_HROMADNE } from "@/lib/stitky";
import { PROGRAM_ACCESS_LABEL } from "@/lib/types";

/**
 * Vybraní klienti do tabulky (CSV) — hromadná akce v seznamu klientů
 * (Fáze 5B, Jakub 11. 10. 2026).
 *
 * **Smí každý přihlášený** (vidí stejné klienty). Nepřihlášený nic.
 * Prohlížeč posílá id formulářem (`POST`) — výběr může mít stovky
 * klientů a do adresy by se nevešel. Cookie sezení je `SameSite=Lax`,
 * takže formulář z cizího webu ji nepošle; navíc se kontroluje `Origin`.
 * Klienti mimo viditelnost a smazaní se tiše přeskočí (podmínka v dotazu).
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Nepřihlášeno.", { status: 401 });
  if (viewer.chybiDvoufazove)
    return new Response("Nejdřív si zapni dvoufázové ověření.", { status: 403 });

  if (jeCiziPuvod(request)) {
    return new Response("Nepovolený požadavek.", { status: 403 });
  }

  const data = await request.formData().catch(() => null);
  const ids = z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(MAX_HROMADNE)
    .safeParse(data?.getAll("id"));
  if (!ids.success) return new Response("Vyber aspoň jednoho klienta.", { status: 400 });

  const klienti = await db.client.findMany({
    where: { AND: [{ id: { in: ids.data } }, viditelniKlienti(viewer)] },
    orderBy: { name: "asc" },
    select: {
      name: true,
      email: true,
      phone: true,
      programAccess: true,
      source: { select: { name: true } },
      platnosti: { where: { validUntil: { not: null } }, select: { validUntil: true } },
      stitky: {
        where: { tag: { deletedAt: null } },
        orderBy: { tag: { name: "asc" } },
        select: { tag: { select: { name: true } } },
      },
      _count: { select: { orders: { where: { deletedAt: null } } } },
    },
  });

  const csv = sestavCsv([
    ["Klienti z CRM Beat Stock Market"],
    ["Staženo", formatDatum(new Date())],
    [],
    [
      "Jméno",
      "E-mail",
      "Telefon",
      "Zdroj",
      "Štítky",
      "Počet objednávek",
      "Poslední konec platnosti",
      "Přístup do programu",
    ],
    ...klienti.map((klient) => {
      const konec = klient.platnosti
        .map((p) => p.validUntil!)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return [
        klient.name,
        klient.email,
        klient.phone ? formatTelefon(klient.phone) : "",
        klient.source.name,
        klient.stitky.map((s) => s.tag.name).join(", "),
        klient._count.orders,
        konec ? formatDatum(konec) : "",
        PROGRAM_ACCESS_LABEL[klient.programAccess],
      ];
    }),
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="klienti-${jakoDen(new Date())}.csv"`,
      // Osobní údaje nemají co ležet v mezipaměti (pravidlo 8).
      "Cache-Control": "no-store",
    },
  });
}
