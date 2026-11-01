import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ZapomenuteForm } from "./zapomenute-form";

export const metadata: Metadata = { title: "Zapomenuté heslo" };

export default function ZapomenuteHesloPage() {
  return (
    <Card>
      <CardHeader>
        {/* Hlavní nadpis stránky pro čtečky obrazovky (axe, 24. 10. 2026). */}
        <CardTitle>
          <h1>Zapomenuté heslo</h1>
        </CardTitle>
        <CardDescription>
          Zadej svůj pracovní e-mail a pošleme ti odkaz, kterým si nastavíš nové heslo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ZapomenuteForm />
      </CardContent>
    </Card>
  );
}
