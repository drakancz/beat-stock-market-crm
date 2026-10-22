import {
  BarChart3,
  Bot,
  CalendarCheck,
  GraduationCap,
  ReceiptText,
  Package,
  Plug,
  Send,
  Settings,
  Trash2,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/enums";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Krátký popis do horní lišty. */
  description: string;
  /**
   * Uvidí položku v menu jen administrátor?
   *
   * **Není to bezpečnostní opatření**, jen úklid menu. Kdo zná adresu,
   * dostane se na ni i bez odkazu — proto má každá taková obrazovka
   * `requireAdmin()` na serveru (`src/app/(app)/sprava/layout.tsx`).
   */
  jenAdmin?: true;
  /**
   * Obrazovka existuje, ale v levém menu se neukazuje. Zůstává v seznamu,
   * aby jí horní lišta i Aktivita uměly dát název.
   */
  skrytaVMenu?: true;
}

/** Hlavní menu interního CRM. Stejné na všech obrazovkách. */
export const navigation: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: BarChart3,
    description: "Co mě dnes čeká a čísla za zvolené období.",
  },
  {
    href: "/klienti",
    label: "Klienti",
    icon: Users,
    description: "Karty klientů, přístup do programu a platnost členství.",
  },
  {
    href: "/objednavky",
    label: "Objednávky",
    icon: ReceiptText,
    description: "Co si klienti koupili a jestli zaplatili.",
  },
  // Brokery Jakub 24. 9. 2026 schoval z menu, stránka žije na své adrese.
  // Portfolia (20. 10. 2026) a Hovory (20. 10. 2026) z CRM zmizely úplně.
  {
    href: "/brokeri",
    label: "Brokeři",
    icon: Plug,
    description: "Katalog brokerů.",
    skrytaVMenu: true,
  },
  {
    href: "/produkty",
    label: "Produkty",
    icon: Package,
    description: "Katalog kurzů, členství a konzultací.",
  },
  {
    // Krok 3C (Jakub, 4. 10. 2026): vidí každý přihlášený, mění administrátor.
    href: "/vzdelavani",
    label: "Vzdělávání",
    icon: GraduationCap,
    description: "Kurzy a lekce, členská sekce a webináře pro klienty.",
  },
  {
    // Fáze 5B (Jakub, 19. 10. 2026): vidí každý přihlášený, termíny vypisuje
    // a rezervace ruší jen administrátor.
    href: "/konzultace",
    label: "Konzultace",
    icon: CalendarCheck,
    description: "Volné termíny konzultací a kdo si je zarezervoval.",
  },
  {
    // Fáze 5D (Jakub, 18. 10. 2026): vidí každý přihlášený, mění administrátor.
    href: "/pravidla",
    label: "Pravidla",
    icon: Workflow,
    description: "Když se stane tohle, CRM samo udělá tamto.",
  },
  {
    // Krok 4 (Jakub, 10. 10. 2026): jen administrátor — vidět i používat.
    href: "/asistent",
    label: "Asistent AI",
    icon: Bot,
    description: "Otázky na data v CRM. Klienti jdou k AI jen pod přezdívkou.",
    jenAdmin: true,
  },
  {
    href: "/sprava",
    label: "Správa",
    icon: UserCog,
    description: "Uživatelé, role a napojení.",
    jenAdmin: true,
  },
  {
    href: "/smazane",
    label: "Smazané",
    icon: Trash2,
    description: "Odstraněné záznamy — vrátit, nebo smazat nenávratně.",
    jenAdmin: true,
  },
  {
    // Jen administrátor (Jakub, 13. 9. 2026) — vidět i používat.
    href: "/smartemailing",
    label: "SmartEmailing",
    icon: Send,
    // Od 15. 9. 2026 večer i záložka Chyby (dřív vlastní položka menu).
    description: "Chyby, odesílání klientů do SmartEmailingu, odhlášení a nastavení propojení.",
    jenAdmin: true,
  },
  {
    // Jen administrátor (Jakub, 10. 9. 2026) — vidět i měnit.
    href: "/nastaveni",
    label: "Nastavení",
    icon: Settings,
    description: "DPH, zdroje klientů, firma, zabezpečení, cíle, pracovní dny a aktivita.",
    jenAdmin: true,
  },
];

/** Obrazovky, které daná role smí znát — včetně těch schovaných z menu. */
function obrazovkyProRoli(role: Role): NavItem[] {
  if (role === "ADMINISTRATOR") return navigation;
  return navigation.filter((item) => !item.jenAdmin);
}

/** Položky levého menu, které má daná role vidět. */
export function menuProRoli(role: Role): NavItem[] {
  return obrazovkyProRoli(role).filter((item) => !item.skrytaVMenu);
}

/**
 * Najde položku menu, do které daná adresa patří — ale jen mezi těmi,
 * které daná role vidí.
 *
 * Role je tu schválně: horní lišta z položky bere nadpis a popis. Bez
 * omezení by se obchodníkovi na 404 z `/sprava` ukázalo v liště „Správa —
 * Uživatelé, role, brokeři a napojení", a tím by se dozvěděl, že sekce
 * existuje a co v ní je. Vracet 404 a nadpis prozradit v liště nedává smysl.
 */
export function findNavItem(pathname: string, role: Role) {
  return obrazovkyProRoli(role).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
