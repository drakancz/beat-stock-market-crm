import { LogoLockup } from "@/components/brand/logo";

/**
 * Rám obrazovek, na které se dostane i nepřihlášený člověk:
 * přihlášení, dvoufázové ověření, zapomenuté a nové heslo.
 *
 * Záměrně bez menu a bez jakéhokoli náznaku toho, co je uvnitř.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-10">
      <LogoLockup subtitle="interní systém" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground max-w-sm text-center text-xs text-balance">
        Přístup jen pro tým Beat Stock Market. Účty zakládá administrátor — veřejná registrace
        neexistuje.
      </p>
    </div>
  );
}
