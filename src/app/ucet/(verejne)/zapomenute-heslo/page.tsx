import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ZapomenuteKlientaForm } from "./zapomenute-form";

export const metadata: Metadata = { title: "Zapomenuté heslo" };

export default function ZapomenuteHesloKlientaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Zapomenuté heslo</h1>
        </CardTitle>
        <CardDescription>
          Zadejte e-mail, kterým se přihlašujete, a pošleme vám odkaz na nové heslo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ZapomenuteKlientaForm />
      </CardContent>
    </Card>
  );
}
