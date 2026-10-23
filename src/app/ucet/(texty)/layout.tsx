import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";

export const dynamic = "force-dynamic";

/**
 * Rám textů pro klienty — zásady ochrany osobních údajů a podmínky
 * (Jakub, 30. 9. 2026). Širší než přihlašovací rám, ať se delší text
 * dobře čte. **Vidí i nepřihlášený** (odkaz je na přihlášení klientů).
 */
export default function TextyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center gap-8 px-4 py-10">
      <header>
        <Link href="/ucet">
          <LogoLockup subtitle="klientská část" />
        </Link>
      </header>
      <main className="bg-card w-full max-w-2xl rounded-xl border p-5 sm:p-8">{children}</main>
      <nav
        aria-label="Dokumenty"
        className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
      >
        <Link
          href="/ucet/zasady"
          className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
        >
          Ochrana osobních údajů
        </Link>
        <Link
          href="/ucet/podminky"
          className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
        >
          Podmínky
        </Link>
        <Link
          href="/ucet/obchodni-podminky"
          className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
        >
          Obchodní podmínky
        </Link>
        <Link
          href="/ucet"
          className="hover:text-foreground inline-flex min-h-6 items-center underline-offset-4 hover:underline"
        >
          Klientská část
        </Link>
      </nav>
    </div>
  );
}
