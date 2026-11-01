import { LogoLockup } from "@/components/brand/logo";
import { ZpetNaLandingPage } from "@/components/zpet-na-landing-page";
import { nactiJazyk } from "@/lib/jazyk-server";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";

/**
 * Rám obrazovek, na které se dostane i nepřihlášený člověk:
 * přihlášení, dvoufázové ověření, zapomenuté a nové heslo.
 *
 * Záměrně bez menu a bez jakéhokoli náznaku toho, co je uvnitř. Podtitul
 * a patička jdou přepnout do angličtiny (src/lib/jazyk.ts).
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const jazyk = await nactiJazyk();
  const t = TEXTY_VSTUPU[jazyk].tym;
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-10">
      <header lang={jazyk}>
        <LogoLockup subtitle={t.podtitul} />
      </header>
      <main className="w-full max-w-sm">{children}</main>
      <footer lang={jazyk} className="flex flex-col items-center gap-6">
        <p className="text-muted-foreground max-w-sm text-center text-xs text-balance">
          {t.paticka}
        </p>
        <ZpetNaLandingPage jazyk={jazyk} />
      </footer>
    </div>
  );
}
