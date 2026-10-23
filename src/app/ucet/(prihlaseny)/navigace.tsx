"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarClock, Crown, House, MessageSquare, ShoppingBag } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Lišta klientské části (krok 3C, 4. 10. 2026): Přehled, Kurzy, Členská
 * sekce, Webináře, Zprávy a od 20. 10. 2026 Koupit. Co klient na které stránce uvidí, rozhoduje
 * server — tady jsou jen odkazy.
 *
 * **Na telefonu je dole** jako v aplikaci (krok 3, varianta B, Jakub
 * 10. 10. 2026), na počítači nahoře pod hlavičkou. Je to jedna lišta, ne
 * dvě — rozvržení mění jen styly. Rám proto dole nechává místo
 * (`pb-24 sm:pb-0`).
 */
const POLOZKY = [
  { href: "/ucet", label: "Přehled", kratce: "Přehled", icon: House },
  { href: "/ucet/kurzy", label: "Kurzy", kratce: "Kurzy", icon: BookOpen },
  { href: "/ucet/clenska-sekce", label: "Členská sekce", kratce: "Členská", icon: Crown },
  { href: "/ucet/webinare", label: "Webináře", kratce: "Webináře", icon: CalendarClock },
  { href: "/ucet/zpravy", label: "Zprávy", kratce: "Zprávy", icon: MessageSquare },
  // Koupit (Jakub, 20. 10. 2026): prodloužení členství, kurzy, konzultace.
  { href: "/ucet/koupit", label: "Koupit", kratce: "Koupit", icon: ShoppingBag },
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
    <nav
      aria-label="Klientská část"
      className={cn(
        // Telefon: pevně dole přes celou šířku, místo pro „bradu" iPhonu.
        "bg-background fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)]",
        // Počítač: pod hlavičkou jako dřív.
        "sm:static sm:z-auto sm:mx-auto sm:max-w-3xl sm:gap-1 sm:border-t-0 sm:bg-transparent sm:px-2 sm:pb-0",
      )}
    >
      {POLOZKY.filter((polozka) => !skryt.includes(polozka.href)).map((polozka) => {
        const aktivni =
          polozka.href === "/ucet" ? pathname === "/ucet" : pathname.startsWith(polozka.href);
        const zpravy = polozka.href === "/ucet/zpravy";

        return (
          <Link
            key={polozka.href}
            href={polozka.href}
            aria-current={aktivni ? "page" : undefined}
            // Celý název i na telefonu, kde je vidět jen zkrácený. U zpráv
            // s počtem se název skládá z obsahu (viz níž), ať sedí s tím,
            // co je vidět — jinak odkaz nejde vyvolat hlasem.
            aria-label={zpravy && neprectenych > 0 ? undefined : polozka.label}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors",
              "sm:-mb-px sm:flex-none sm:flex-row sm:gap-1.5 sm:border-b-2 sm:px-2.5 sm:py-2 sm:text-sm sm:whitespace-nowrap",
              aktivni
                ? "text-primary sm:border-primary sm:text-foreground"
                : "text-muted-foreground hover:text-foreground sm:border-transparent",
            )}
          >
            <polozka.icon className="size-5 sm:size-4" aria-hidden />
            <span className="truncate sm:hidden">{polozka.kratce}</span>
            <span className="hidden sm:inline">{polozka.label}</span>
            {zpravy && neprectenych > 0 && (
              <>
                <span className="bg-primary text-primary-foreground absolute top-1 left-1/2 ml-1.5 rounded-full px-1.5 text-[10px] leading-4 tabular-nums sm:static sm:ml-0 sm:text-xs sm:leading-5">
                  {neprectenych}
                </span>
                <span className="sr-only"> nepřečtené</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
