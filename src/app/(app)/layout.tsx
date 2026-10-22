import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { PruhUkazky } from "@/components/pruh-ukazky";
import { PruvodceUkazkou } from "@/components/pruvodce-ukazkou";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SentryUzivatel } from "@/components/sentry-uzivatel";
import { ZaznamObrazovek } from "@/components/zaznam-obrazovek";
import { nactiPripominky } from "@/lib/queries";
import { requireViewer } from "@/lib/session";
import { jeUkazkovyTym } from "@/lib/ukazka";

/**
 * Rám celého interního CRM: levé menu, horní lišta, obsah.
 * Na telefonu se menu schová do vysouvacího panelu.
 *
 * Každá otevřená obrazovka se zapisuje do Aktivity (`ZaznamObrazovek`).
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Rám se vykresluje i kolem Mého účtu, kam smí i ten, komu chybí
  // povinné dvoufázové ověření. Každá obrazovka si to hlídá sama svým
  // `requireViewer()`.
  const viewer = await requireViewer({ bezDvoufazoveho: true });

  // Zvoneček v horní liště (26. 9. 2026). Kdo ještě musí zapnout povinné
  // dvoufázové ověření, vidí jen Můj profil — připomínky mu zatím nejdou.
  const pripominky = viewer.chybiDvoufazove ? [] : await nactiPripominky(viewer);

  return (
    <SidebarProvider>
      <ZaznamObrazovek />
      {/* K chybě v prohlížeči se připojí jen ID a role — viz komponenta. */}
      <SentryUzivatel id={viewer.id} role={viewer.role} />
      <AppSidebar viewer={viewer} />
      <SidebarInset className="min-w-0">
        <PruhUkazky />
        <AppTopbar role={viewer.role} pripominky={pripominky} />
        <div className="flex-1 px-3 py-5 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[1400px] space-y-6">{children}</div>
        </div>
        {/* Průvodce „Co si vyzkoušet“ jen pro ukázkový účet (Jakub, 22. 10. 2026). */}
        {jeUkazkovyTym(viewer.email) && <PruvodceUkazkou druh="tym" />}
      </SidebarInset>
    </SidebarProvider>
  );
}
