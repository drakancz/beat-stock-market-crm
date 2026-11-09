"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ListPlus,
  Mail,
  Megaphone,
  Percent,
  ShieldCheck,
  Tags,
  Target,
  Webhook,
} from "lucide-react";

import { cn } from "@/lib/utils";

const POLOZKY = [
  { href: "/nastaveni", label: "Sazby DPH", icon: Percent },
  { href: "/nastaveni/zdroje", label: "Zdroje klientů", icon: Megaphone },
  { href: "/nastaveni/stitky", label: "Štítky", icon: Tags },
  { href: "/nastaveni/pole", label: "Vlastní pole", icon: ListPlus },
  { href: "/nastaveni/firma", label: "Firma a e-maily", icon: Building2 },
  { href: "/nastaveni/sablony", label: "Šablony e-mailů", icon: Mail },
  { href: "/nastaveni/zabezpeceni", label: "Zabezpečení", icon: ShieldCheck },
  { href: "/nastaveni/upozorneni", label: "Upozornění", icon: Bell },
  { href: "/nastaveni/webhooky", label: "Webhooky", icon: Webhook },
  { href: "/nastaveni/kalendar", label: "Kalendář", icon: CalendarCheck },
  { href: "/nastaveni/cile", label: "Cíle", icon: Target },
  { href: "/nastaveni/prodlouzeni", label: "Prodloužení", icon: CalendarClock },
  { href: "/nastaveni/pracovni-dny", label: "Pracovní dny", icon: CalendarDays },
  { href: "/nastaveni/aktivita", label: "Aktivita", icon: Activity },
] as const;

/** Záložky mezi částmi Nastavení. Obyčejné odkazy — každá část má vlastní adresu. */
export function PodmenuNastaveni() {
  const pathname = usePathname();

  return (
    <nav aria-label="Části nastavení" className="border-border flex gap-1 overflow-x-auto border-b">
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
