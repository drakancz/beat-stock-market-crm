"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, Settings2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const POLOZKY = [
  // Chyby jsou od 15. 9. 2026 záložkou SmartEmailingu, první zleva (Jakub).
  { href: "/smartemailing/chyby", label: "Chyby", icon: TriangleAlert },
  { href: "/smartemailing", label: "Synchronizace kontaktů", icon: RefreshCw },
  { href: "/smartemailing/nastaveni", label: "Nastavení propojení", icon: Settings2 },
] as const;

/** Záložky sekce SmartEmailing. Obyčejné odkazy — každá část má vlastní adresu. */
export function PodmenuSmartemailingu() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Části SmartEmailingu"
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {POLOZKY.map((polozka) => {
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
