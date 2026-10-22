import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Moje údaje ke stažení (Jakub, 21. 10. 2026) — kopie všeho, co o klientovi
 * CRM vede, ve dvou podobách. Soubory skládá `src/lib/klient/moje-udaje.ts`
 * jen pro přihlášeného klienta.
 */
export function MojeUdajeKeStazeni() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Moje údaje ke stažení</CardTitle>
        <CardDescription>
          Kopie údajů, které o vás vedeme: osobní a fakturační údaje, souhlasy, objednávky,
          členství, postup v kurzech, konzultace a zprávy. PDF je k přečtení, JSON ve strojově
          čitelné podobě, kterou můžete předat jiné službě.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href="/ucet/moje-udaje.pdf" download>
            <Download />
            Stáhnout (PDF)
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="/ucet/moje-udaje.json" download>
            <Download />
            Stáhnout (JSON)
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
