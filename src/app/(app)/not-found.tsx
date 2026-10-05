import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Stránka nenalezena — uvnitř přihlášené aplikace.
 *
 * Sem člověk dojde dvěma cestami: buď adresa opravdu neexistuje, nebo
 * na ni nemá právo (`requireAdmin()` vrací `notFound()`). **Hláška je
 * schválně pro oba případy stejná** a neříká „nemáte oprávnění" — z
 * odpovědi se tak nedá vyčíst, co všechno v systému je.
 */
export default function Nenalezeno() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-muted-foreground font-heading text-5xl font-semibold">404</p>

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Tady nic není</h2>
        <p className="text-muted-foreground text-sm">
          Stránka neexistuje, nebo k ní tvůj účet nemá přístup.
        </p>
      </div>

      <Button asChild variant="outline">
        <Link href="/dashboard">Zpět na Dashboard</Link>
      </Button>
    </div>
  );
}
