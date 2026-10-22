import type { Metadata } from "next";
import Link from "next/link";
import { Database, Palette, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { nactiUzivatele } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL, ROLE_SCOPE } from "@/lib/types";
import { jeUkazkovyTym } from "@/lib/ukazka";

export const metadata: Metadata = { title: "Správa" };

export const dynamic = "force-dynamic";

export default async function SpravaPage() {
  // Do celé sekce pustí jen administrátora už rám (`layout.tsx`). Kontrola
  // je tu podruhé schválně — obrazovka se čte samostatně a nemá záviset na
  // tom, že si někdo všimne souboru o patro výš. Dotaz proběhne jednou,
  // `getViewer()` je pro jedno vykreslení v paměti.
  const admin = await requireAdmin();
  const uzivatele = await nactiUzivatele();
  // Ukázkový účet Správu uživatelů nemá a e-maily kolegů neuvidí.
  const ukazka = jeUkazkovyTym(admin.email);

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Správa</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Uživatelé, role a napojení na okolní systémy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Uživatelé a role
          </CardTitle>
          <CardDescription>
            Tým má maximálně pět lidí, role proto zůstávají jednoduché — ale nastavitelné, ne
            napevno v kódu.
          </CardDescription>
          {!ukazka && (
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <Link href="/sprava/uzivatele">Spravovat uživatele</Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <div className="-mx-2 overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jméno</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Co vidí</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uzivatele.map((uzivatel) => (
                  <TableRow key={uzivatel.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {uzivatel.name}
                      {!ukazka && (
                        <span className="text-muted-foreground block text-xs">{uzivatel.email}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABEL[uzivatel.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ROLE_SCOPE[uzivatel.role]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" aria-hidden />
              Databáze
            </CardTitle>
            <CardDescription>PostgreSQL běží jako služba v Dockeru.</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Data se ukládají do svazku, takže přežijí restart i přestavbu aplikace.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4" aria-hidden />
              Sada prvků
            </CardTitle>
            <CardDescription>
              Tlačítka, formuláře, tabulky, dialogy a hlášky. Postaveno jednou, používá se všude.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/sprava/prvky">Otevřít sadu prvků</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden />
              Auditní log
            </CardTitle>
            <CardDescription>Kdo co změnil. Sbírá se od prvního dne.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Zapisuje se do něj každá změna v systému. Spolu s přihlášeními a otevřenými
              obrazovkami je vidět v Nastavení → Aktivita.
            </p>
            <Button asChild variant="outline">
              <Link href="/nastaveni/aktivita">Otevřít aktivitu</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
