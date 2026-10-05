"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarClock, Crown, House, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Lišta klientské části (krok 3C, 4. 10. 2026): Přehled, Kurzy, Členská
 * sekce, Webináře, Zprávy. Na telefonu se dá posouvat do strany. Co klient
 * na které stránce uvidí, rozhoduje server — tady jsou jen odkazy.
 */
const POLOZKY = [
  { href: "/ucet", label: "Přehled", icon: House },
  { href: "/ucet/kurzy", label: "Kurzy", icon: BookOpen },
  { href: "/ucet/clenska-sekce", label: "Členská sekce", icon: Crown },
  { href: "/ucet/webinare", label: "Webináře", icon: CalendarClock },
  { href: "/ucet/zpravy", label: "Zprávy", icon: MessageSquare },
] as const;

export function NavigaceKlienta({
  neprectenych,
  skryt = [],
}: {
  neprectenych: number;
  /** Položky, které zatím nejsou (části kroku 3C přibývají postupně). */
  skryt?: string[];
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Klientská část" className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2">
      {POLOZKY.filter((polozka) => !skryt.includes(polozka.href)).map((polozka) => {
        const aktivni =
          polozka.href === "/ucet" ? pathname === "/ucet" : pathname.startsWith(polozka.href);
        const zpravy = polozka.href === "/ucet/zpravy";

        return (
          <Link
            key={polozka.href}
            href={polozka.href}
            aria-current={aktivni ? "page" : undefined}
            aria-label={
              zpravy && neprectenych > 0 ? `Zprávy, nepřečtené: ${neprectenych}` : undefined
            }
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              aktivni
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <polozka.icon className="size-4" aria-hidden />
            {polozka.label}
            {zpravy && neprectenych > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs leading-5 tabular-nums">
                {neprectenych}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
