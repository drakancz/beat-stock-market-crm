import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDatumCas } from "@/lib/format";
import { nactiNedorucitelne } from "@/lib/smartemailing-synchronizace";

/**
 * Seznam Špatný e-mail v SmartEmailing → Synchronizace kontaktů (Jakub,
 * 13. 9. 2026). Jen pro administrátora — vykresluje ho jen stránka sekce,
 * kterou hlídá `requireAdmin()` v rámu i na prvním řádku.
 *
 * Nedoručitelným klientům se souhlas neodebírá; tady je vidět, komu je
 * potřeba opravit adresu.
 */
export async function SpatnyEmail() {
  const klienti = await nactiNedorucitelne();
  if (klienti.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        Špatný e-mail
        <Badge variant="destructive">{klienti.length}</Badge>
      </h3>
      <p className="text-muted-foreground text-xs leading-relaxed">
        SmartEmailing na tyhle adresy nedoručí. Souhlas s marketingem klientům zůstává — oprav
        e-mail na kartě klienta a ze seznamu zmizí.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Klient</TableHead>
            <TableHead>Zjištěno</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {klienti.map((klient) => (
            <TableRow key={klient.clientId}>
              <TableCell>
                <Link href={`/klienti/${klient.clientId}`} className="font-medium hover:underline">
                  {klient.name}
                </Link>
                <div className="text-muted-foreground text-xs">{klient.email ?? "—"}</div>
              </TableCell>
              <TableCell className="tabular whitespace-nowrap">
                {klient.at ? formatDatumCas(klient.at) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
