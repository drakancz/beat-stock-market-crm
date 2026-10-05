import type { Metadata } from "next";
import { Building2, Mail } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";

import { FormularEmailu, FormularFirmy } from "./formulare";

export const metadata: Metadata = { title: "Firma a e-maily" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Firma a e-maily.
 *
 * **Vidí i mění jen administrátor** (Jakub, 10. 9. 2026). Údaje firmy
 * se zatím objevují v patičce e-mailů; později na nabídkách.
 */
export default async function FirmaPage() {
  await requireAdmin();
  const nastaveni = await nactiNastaveni();

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Údaje firmy
          </CardTitle>
          <CardDescription>
            Objeví se v patičce e-mailů ze systému. Plátce DPH je zatím jen údaj — ceny s DPH se
            ukazují tak jako tak.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularFirmy
            firma={{
              companyName: nastaveni.companyName,
              ico: nastaveni.ico,
              dic: nastaveni.dic,
              address: nastaveni.address,
              contactEmail: nastaveni.contactEmail,
              vatPayer: nastaveni.vatPayer,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="text-muted-foreground size-4 shrink-0" aria-hidden />
            E-maily
          </CardTitle>
          <CardDescription>
            Pozvánka, obnova hesla a uvítání. Hromadné kampaně zůstávají ve SmartEmailingu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularEmailu
            jmenoOdesilatele={nastaveni.emailSenderName}
            podpis={nastaveni.emailSignature}
          />
        </CardContent>
      </Card>
    </div>
  );
}
