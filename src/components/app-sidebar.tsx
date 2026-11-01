"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";

import { LogoLockup } from "@/components/brand/logo";
import { PrepinacVzhledu } from "@/components/prepinac-vzhledu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth-client";
import { menuProRoli } from "@/lib/navigation";
import { ROLE_LABEL } from "@/lib/types";
import type { Viewer } from "@/lib/session";

// Přihlášeného uživatele předává rám aplikace — komponenta běží v prohlížeči
// a do databáze sáhnout nemůže.
export function AppSidebar({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    // Celý panel je pro čtečku obrazovky oblast „Hlavní menu“ — bez ní
    // menu nepatřilo do žádné oblasti stránky (axe, 24. 10. 2026).
    <Sidebar collapsible="icon" role="navigation" aria-label="Hlavní menu">
      <SidebarHeader className="h-16 justify-center px-3">
        <Link
          href="/dashboard"
          onClick={() => setOpenMobile(false)}
          className="focus-visible:ring-sidebar-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <LogoLockup className="group-data-[collapsible=icon]:[&_span:last-child]:hidden" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Interní CRM</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuProRoli(viewer.role).map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex items-center gap-2.5 rounded-md px-1 py-1 text-left group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-sidebar-accent text-sidebar-accent-foreground font-heading grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
                {viewer.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
              <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">{viewer.name}</span>
                <span className="text-sidebar-foreground/70 truncate text-xs">
                  {ROLE_LABEL[viewer.role]}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{viewer.name}</span>
              <span className="text-muted-foreground block truncate text-xs">{viewer.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profil" onClick={() => setOpenMobile(false)}>
                <UserRound />
                Můj profil
              </Link>
            </DropdownMenuItem>
            <PrepinacVzhledu />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await signOut({ callbackUrl: "/prihlaseni" });
              }}
            >
              <LogOut />
              Odhlásit se
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
