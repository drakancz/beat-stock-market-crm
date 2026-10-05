"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Pripominky, type Pripominka } from "@/components/pripominky";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { findNavItem } from "@/lib/navigation";
import type { Role } from "@/generated/prisma/enums";

/**
 * Horní lišta. Stejná na všech obrazovkách.
 *
 * Roli předává rám aplikace. Slouží jen k tomu, aby lišta nepojmenovala
 * sekci, na kterou uživatel nemá — obsah stránky hlídá server.
 */
export function AppTopbar({ role, pripominky }: { role: Role; pripominky: Pripominka[] }) {
  const pathname = usePathname();
  const parametry = useSearchParams();
  const active = findNavItem(pathname, role);

  // Můj profil v hlavním menu není — je dole u jména. Lišta ho má
  // pojmenovat stejně, jinak by na něm svítilo jen „CRM".
  const profil = pathname === "/profil";
  const nadpis = active?.label ?? (profil ? "Můj profil" : "CRM");
  const popis =
    active?.description ?? (profil ? "Osobní údaje, heslo a zabezpečení přihlášení." : undefined);

  // Na seznamu klientů ať políčko ukazuje, co se právě hledá — jinak by
  // vedle vyfiltrovaného seznamu svítilo prázdné pole. `key` ho přinutí
  // převzít novou hodnotu, když filtr změní někdo jiný než ono samo.
  const hledane = pathname === "/klienti" ? (parametry.get("hledat") ?? "") : "";

  return (
    <header className="bg-background/85 sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b px-3 backdrop-blur-sm sm:px-5">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="hidden !h-5 sm:block" />

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold sm:text-lg">{nadpis}</h1>
        <p className="text-muted-foreground hidden truncate text-xs lg:block">{popis}</p>
      </div>

      {/*
        Hledání odsud vede na seznam klientů s předvyplněným filtrem.
        Vlastní výsledky tu nevykresluje — seznam už umí totéž a nemusí se
        udržovat dvakrát. Hledá se jen v tom, co daná role vidí; omezení
        je v dotazu do databáze, ne tady.
      */}
      {/* Na telefonu je místo pole jen lupa, která vede na seznam klientů
          s vlastním hledáním (26. 9. 2026) — pole vedle zvonečku by
          z názvu obrazovky nechalo „Dashb…". */}
      <Button variant="ghost" size="icon" className="shrink-0 sm:hidden" asChild>
        <Link href="/klienti" aria-label="Hledat klienta">
          <Search />
        </Link>
      </Button>
      <form action="/klienti" className="relative hidden w-full max-w-64 shrink sm:block">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          name="hledat"
          defaultValue={hledane}
          key={hledane}
          placeholder="Hledat klienta…"
          aria-label="Hledat klienta"
          maxLength={100}
          className="bg-card pl-8"
        />
      </form>

      <Pripominky ukoly={pripominky} />
    </header>
  );
}
