import type { Metadata } from "next";
import { ShieldCheck, UserX } from "lucide-react";

import { PoznamkaPodCarou } from "@/components/poznamka-pod-carou";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { MAX_HODIN_PRIHLASENI, dvoufazovePovinne, nactiNastaveni } from "@/lib/nastaveni";
import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";

import { FormularZabezpeceni } from "./formular";

export const metadata: Metadata = { title: "Zabezpečení" };

export const dynamic = "force-dynamic";

/**
 * Nastavení → Zabezpečení.
 *
 * **Vidí i mění jen administrátor** (Jakub, 10. 9. 2026). Pod formulářem
 * je seznam lidí bez dvoufázového ověření — ať je před uložením vidět,
 * koho povinnost zasáhne.
 */
export default async function ZabezpeceniPage() {
  await requireAdmin();

  const [nastaveni, bezOvereni] = await Promise.all([
    nactiNastaveni(),
    db.user.findMany({
      where: { active: true, deletedAt: null, twoFactorEnabled: false },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Zabezpečení přihlášení
          </CardTitle>
          <CardDescription>
            Systém drží osobní údaje klientů a jejich investiční účty — samotné heslo je málo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularZabezpeceni
            politika={nastaveni.twoFactorPolicy}
            hodin={nastaveni.sessionHours}
            maxHodin={MAX_HODIN_PRIHLASENI}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Kdo zatím nemá dvoufázové ověření
          </CardTitle>
          <CardDescription>
            {bezOvereni.length === 0
              ? "Všichni ho mají zapnuté."
              : "Při povinném ověření se tihle lidé po přihlášení dostanou jen na Můj účet."}
          </CardDescription>
        </CardHeader>
        {bezOvereni.length > 0 && (
          <CardContent>
            <ul className="divide-border divide-y">
              {bezOvereni.map((clovek) => (
                <li key={clovek.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex-1 text-sm font-medium">{clovek.name}</span>
                  <span className="text-muted-foreground text-xs">{ROLE_LABEL[clovek.role]}</span>
                  {dvoufazovePovinne(nastaveni.twoFactorPolicy, clovek.role) && (
                    <Badge variant="destructive">Teď se nedostane dál</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <PoznamkaPodCarou>
        Povinnost se vyhodnocuje při každém požadavku na serveru — kdo zná adresu jiné obrazovky,
        stejně skončí na Mém účtu. Každá změna jde do auditního logu.
      </PoznamkaPodCarou>
    </>
  );
}
