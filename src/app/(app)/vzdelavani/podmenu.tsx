"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarClock, Crown, MessageCircleQuestion } from "lucide-react";

import { cn } from "@/lib/utils";

const POLOZKY = [
  { href: "/vzdelavani", label: "Kurzy", icon: BookOpen },
  { href: "/vzdelavani/clenska-sekce", label: "Členská sekce", icon: Crown },
  { href: "/vzdelavani/webinare", label: "Webináře", icon: CalendarClock },
  // Dotazy klientů k lekcím (5C, 18. 10. 2026) — s počtem čekajících.
  { href: "/vzdelavani/dotazy", label: "Dotazy", icon: MessageCircleQuestion },
] as const;

/** Záložky sekce Vzdělávání. Kurzy jsou aktivní i na detailu kurzu. */
export function PodmenuVzdelavani({ cekajicichDotazu }: { cekajicichDotazu: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Části vzdělávání"
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {POLOZKY.map((polozka) => {
        const aktivni =
          polozka.href === "/vzdelavani"
            ? pathname === "/vzdelavani" || pathname.startsWith("/vzdelavani/kurzy")
            : pathname.startsWith(polozka.href);

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
            {polozka.href === "/vzdelavani/dotazy" && cekajicichDotazu > 0 && (
              <span
                className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums"
                aria-label={`čeká ${cekajicichDotazu}`}
              >
                {cekajicichDotazu}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
