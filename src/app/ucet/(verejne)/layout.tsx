import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";
import { ZpetNaLandingPage } from "@/components/zpet-na-landing-page";
import { nactiJazyk } from "@/lib/jazyk-server";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";

/**
 * Rám veřejných obrazovek klientské části: přihlášení, zapomenuté heslo,
 * nastavení hesla a texty. Bez jakéhokoli náznaku interního CRM.
 * Podtitul a patička jdou přepnout do angličtiny (src/lib/jazyk.ts).
 */
export default async function VerejneLayout({ children }: { children: React.ReactNode }) {
  const jazyk = await nactiJazyk();
  const t = TEXTY_VSTUPU[jazyk];
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-10">
      <header lang={jazyk}>
        <LogoLockup subtitle={t.klient.podtitul} />
      </header>
      <main className="w-full max-w-sm">{children}</main>
      <footer lang={jazyk} className="flex flex-col items-center gap-8">
        <p className="text-muted-foreground max-w-sm text-center text-xs text-balance">
          {t.klient.paticka}
        </p>
        <nav
          aria-label={t.dokumenty.nazev}
          className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
        >
          <Link
            href="/ucet/zasady"
            className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
          >
            {t.dokumenty.zasady}
          </Link>
          <Link
            href="/ucet/podminky"
            className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
          >
            {t.dokumenty.podminky}
          </Link>
          <Link
            href="/ucet/obchodni-podminky"
            className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
          >
            {t.dokumenty.obchodni}
          </Link>
        </nav>
        <ZpetNaLandingPage jazyk={jazyk} />
      </footer>
    </div>
  );
}
