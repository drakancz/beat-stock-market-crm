import type { Metadata } from "next";
import { ShieldAlert, UserRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { nactiKlice } from "@/lib/mcp/klice";
import { requireViewer } from "@/lib/session";
import { ROLE_LABEL, ROLE_SCOPE } from "@/lib/types";

import { SekcePriloh } from "@/components/soubory/sekce-priloh";

import { Dvoufazove } from "./dvoufazove";
import { KliceMcp } from "./klice-mcp";
import { OsobniUdaje } from "./osobni-udaje";
import { ZmenaHesla } from "./zmena-hesla";

export const metadata: Metadata = { title: "Můj profil" };

export const dynamic = "force-dynamic";

/**
 * Můj profil — osobní údaje, heslo a dvoufázové ověření.
 *
 * **Svůj profil vidí a upravuje každý přihlášený** (Jakub, 10. 9. 2026).
 * Cizí profil tu otevřít nejde; administrátor má profily kolegů ve Správě.
 */
export default async function ProfilPage() {
  // Jediná obrazovka, kam smí i ten, komu chybí povinné dvoufázové
  // ověření — tady si ho zapne.
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  const ucet = await db.user.findUniqueOrThrow({
    where: { id: viewer.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      vocative: true,
      twoFactorEnabled: true,
    },
  });

  // Komu chybí povinné dvoufázové ověření, klíč stejně neprojde
  // (`overKlic()`) — oddíl se mu proto neukazuje vůbec.
  const klice =
    viewer.role === "ADMINISTRATOR" && !viewer.chybiDvoufazove ? await nactiKlice(viewer.id) : null;

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Můj profil</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Osobní údaje, heslo a zabezpečení přihlášení. Roli si měnit nemůžeš — tu nastavuje
          administrátor.
        </p>
      </div>

      {viewer.chybiDvoufazove && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Nejdřív si zapni dvoufázové ověření</AlertTitle>
          <AlertDescription>
            Administrátor ho nastavil jako povinné. Dokud ho nezapneš, zbytek systému se ti
            neotevře. Zabere to minutu — stačí aplikace na kódy v telefonu (třeba Google
            Authenticator nebo Microsoft Authenticator).
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            Osobní údaje
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{ROLE_LABEL[viewer.role]}</Badge>
            <span>{ROLE_SCOPE[viewer.role]}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OsobniUdaje
            vlastni
            udaje={{
              userId: viewer.id,
              email: ucet.email,
              firstName: ucet.firstName,
              lastName: ucet.lastName,
              phone: ucet.phone,
              vocative: ucet.vocative,
            }}
          />
        </CardContent>
      </Card>

      <SekcePriloh
        typ="UZIVATEL"
        id={viewer.id}
        popis="Tvoje soubory — smlouva, certifikáty, cokoli k tvému účtu. Vidíš je ty a správce systému."
      />

      <ZmenaHesla />

      <Dvoufazove zapnuto={ucet.twoFactorEnabled} />

      {/* Klíče pro AI (MCP) — vidí a spravuje jen administrátor, a jen svoje
          (Jakub, 27. 9. 2026). Akce si roli ověřují samy (`mcp-actions.ts`). */}
      {klice && (
        <KliceMcp
          klice={klice}
          adresa={`${process.env.AUTH_URL ?? "http://localhost:3000"}/api/mcp`}
        />
      )}
    </>
  );
}
