import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";

/**
 * Rám veřejných obrazovek klientské části: přihlášení, zapomenuté heslo,
 * nastavení hesla a texty. Bez jakéhokoli náznaku interního CRM.
 */
export default function VerejneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-10">
      <LogoLockup subtitle="klientská část" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground max-w-sm text-center text-xs text-balance">
        Účet do klientské části vám zřídíme po objednávce. Veřejná registrace neexistuje.
      </p>
      <nav
        aria-label="Dokumenty"
        className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
      >
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
        <Link
          href="/ucet/obchodni-podminky"
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          Obchodní podmínky
        </Link>
      </nav>
    </div>
  );
}
