import type { Metadata } from "next";

/**
 * Klientská část (krok 3A, Jakub, 30. 9. 2026) — adresy `/ucet/…`.
 *
 * Je to **druhá tvář téhož systému** nad stejnou databází, ale s vlastním
 * přihlášením (`src/lib/klient/sezeni.ts`). S rámem interního CRM
 * (`src/app/(app)`) nesdílí nic kromě písem a barev.
 *
 * - `(verejne)` — přihlášení, zapomenuté heslo, nastavení hesla z odkazu
 *   a texty; dostane se tam i nepřihlášený.
 * - `(prihlaseny)` — všechno ostatní; rám volá `requireKlient()`.
 */
export const metadata: Metadata = {
  title: { default: "Klientská část", template: "%s · Beat Stock Market" },
  description: "Klientská část Beat Stock Market: objednávky, členství a vaše údaje.",
  // Klientská část nemá co dělat ve vyhledávačích.
  robots: { index: false, follow: false },
  // Klientská část jako vlastní aplikace na ploše (krok 3A, 4. 10. 2026).
  manifest: "/ucet/aplikace.webmanifest",
  appleWebApp: { capable: true, title: "Beat Stock", statusBarStyle: "default" },
};

export default function UcetLayout({ children }: LayoutProps<"/ucet">) {
  return children;
}
