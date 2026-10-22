"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HandCoins, Package, TicketPercent } from "lucide-react";

import { cn } from "@/lib/utils";

const POLOZKY = [
  { href: "/produkty", label: "Katalog", icon: Package, jenAdmin: false },
  { href: "/produkty/slevove-kody", label: "Slevové kódy", icon: TicketPercent, jenAdmin: false },
  // Doporučitelé a odměny (5A, 15. 10. 2026) — jen administrátor.
  { href: "/produkty/doporucitele", label: "Doporučitelé", icon: HandCoins, jenAdmin: true },
] as const;

/**
 * Záložky sekce Produkty (Fáze 5A, 14. 10. 2026) — stejný vzhled jako v Nastavení.
 *
 * Skrytá záložka je jen úklid — stránku chrání `requireAdmin()`.
 */
export function ZalozkyProduktu({ jeAdmin }: { jeAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Části produktů" className="border-border flex gap-1 overflow-x-auto border-b">
      {POLOZKY.filter((polozka) => jeAdmin || !polozka.jenAdmin).map((polozka) => {
        const aktivni = pathname === polozka.href;

        return (
          <Link
            key={polozka.href}
            href={polozka.href}
            aria-current={aktivni ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              aktivni
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <polozka.icon className="size-4" aria-hidden />
            {polozka.label}
          </Link>
        );
      })}
    </nav>
  );
}
