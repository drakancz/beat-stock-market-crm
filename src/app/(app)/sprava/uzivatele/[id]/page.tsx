import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, UserRound } from "lucide-react";

import { SekcePriloh } from "@/components/soubory/sekce-priloh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDatum } from "@/lib/format";
import { idZAdresy } from "@/lib/parametry";
import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";

import { OsobniUdaje } from "../../../profil/osobni-udaje";

export const metadata: Metadata = { title: "Profil uživatele" };

export const dynamic = "force-dynamic";

/**
 * Profil kolegy pro administrátora (Správa → Uživatelé → jméno).
 *
 * **Vidí a upravuje jen administrátor** (Jakub, 10. 9. 2026) — zábrana
 * je v rámu Správy i tady. Jen tady a v Mém profilu je vidět telefon.
 * Účet v koši tu není; vrací se ze Smazaných.
 */
export default async function ProfilUzivatelePage({ params }: PageProps<"/sprava/uzivatele/[id]">) {
  const admin = await requireAdmin();
  const id = idZAdresy((await params).id);
  if (!id) notFound();

  const uzivatel = await db.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      firstName: true,
      lastName: true,
      phone: true,
      vocative: true,
      twoFactorEnabled: true,
      passwordHash: true,
      createdAt: true,
    },
  });
  if (!uzivatel) notFound();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{uzivatel.name}</h2>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{ROLE_LABEL[uzivatel.role]}</Badge>
            {!uzivatel.active && <Badge variant="outline">Přístup odebrán</Badge>}
            {uzivatel.passwordHash === null && (
              <Badge variant="outline">Čeká na nastavení hesla</Badge>
            )}
            {uzivatel.twoFactorEnabled && (
              <Badge variant="outline">
                <ShieldCheck className="size-3" aria-hidden />
                Dvoufázové
              </Badge>
            )}
            <span>V systému od {formatDatum(uzivatel.createdAt)}</span>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/sprava/uzivatele">
            <ArrowLeft />
            Zpět na uživatele
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Osobní údaje
          </CardTitle>
          <CardDescription>
            Změny se zapíšou do auditního logu. Roli, přístup a odkaz na heslo měníš v seznamu
            uživatelů.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OsobniUdaje
            vlastni={uzivatel.id === admin.id}
            udaje={{
              userId: uzivatel.id,
              email: uzivatel.email,
              firstName: uzivatel.firstName,
              lastName: uzivatel.lastName,
              phone: uzivatel.phone,
              vocative: uzivatel.vocative,
            }}
          />
        </CardContent>
      </Card>

      <SekcePriloh
        typ="UZIVATEL"
        id={uzivatel.id}
        popis={`Soubory u účtu ${uzivatel.name}. Vidí je jen majitel účtu a správce systému.`}
      />
    </>
  );
}
