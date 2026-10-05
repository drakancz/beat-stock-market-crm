import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";

import { LogoLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { requireKlient } from "@/lib/klient/sezeni";
import { zaznamenejAktivitu } from "@/lib/vzdelavani/odznaky";

import { InstalaceAplikace } from "./instalace-aplikace";
import { NavigaceKlienta } from "./navigace";

import { odhlasitKlienta } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Rám klientské části pro přihlášeného klienta.
 *
 * **Kdo sem smí (Jakub, 30. 9. 2026):** jen přihlášený klient, a každá
 * obrazovka ukazuje jen jeho vlastní data. Nepřihlášený i člověk z týmu
 * skončí na přihlášení klientů. `requireKlient()` si volá každá stránka
 * i akce znovu — rám chrání zobrazení, ne serverové akce.
 */
export default async function PrihlasenyLayout({ children }: { children: React.ReactNode }) {
  const klient = await requireKlient();

  // Počet nepřečtených zpráv u odkazu Zprávy (3A, 4. 10. 2026).
  const [neprectenych] = await Promise.all([
    db.clientMessage.count({ where: { clientId: klient.clientId, readAt: null } }),
    // Týden, kdy byl klient v klientské části — kvůli odznaku za
    // pravidelnou aktivitu (3C). Nic dalšího o návštěvě se neukládá.
    zaznamenejAktivitu(klient.clientId),
  ]);

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="bg-background border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/ucet" aria-label="Klientská část — úvod" className="min-w-0">
            <LogoLockup subtitle="klientská část" />
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/ucet/profil">
                <UserRound />
                <span className="sr-only sm:not-sr-only">Můj profil</span>
              </Link>
            </Button>
            <form action={odhlasitKlienta}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut />
                Odhlásit
              </Button>
            </form>
          </div>
        </div>
        <NavigaceKlienta neprectenych={neprectenych} />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
        <InstalaceAplikace />
        {children}
      </main>

      <footer className="text-muted-foreground mx-auto flex w-full max-w-3xl flex-wrap gap-4 px-4 py-6 text-xs">
        <Link
          href="/ucet/zasady"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          Ochrana osobních údajů
        </Link>
        <Link
          href="/ucet/podminky"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          Podmínky
        </Link>
      </footer>
    </div>
  );
}
