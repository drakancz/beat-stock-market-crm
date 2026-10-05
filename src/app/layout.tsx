import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { headers } from "next/headers";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

/*
 * Písma značky Beat Stock Market (Jakub, 22. 9. 2026). Přiřazují se
 * k proměnným, které si v `globals.css` bere Tailwind — jinde v aplikaci
 * se na konkrétní písmo nespoléhá.
 *
 * `latin-ext` je povinné, jinak by háčky a čárky spadly na náhradní písmo.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/*
 * IBM Plex Mono **není na Google Fonts proměnné písmo** (ověřeno 22. 9.
 * 2026 — dotaz na rozsah `wght@100..700` vrací 400). Váhy se proto musí
 * vyjmenovat; bez toho sestavení spadne.
 */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CRM Beat Stock Market",
    template: "%s · CRM Beat Stock Market",
  },
  description:
    "Interní systém Beat Stock Market: klienti, hovory, úkoly, portfolia, produkty a statistiky na jednom místě.",
  /*
   * CRM jako aplikace na ploše telefonu (krok 3A, 4. 10. 2026). Klientská
   * část si v `src/app/ucet/layout.tsx` nastavuje vlastní manifest.
   * Ikonu pro iPhone dává soubor `src/app/apple-icon.png`.
   */
  manifest: "/aplikace.webmanifest",
  appleWebApp: { capable: true, title: "BSM CRM", statusBarStyle: "default" },
};

/* Barva lišty prohlížeče na telefonu — papírová a tmavě modrá ze značky. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfa" },
    { media: "(prefers-color-scheme: dark)", color: "#101423" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /*
   * Klíč ke skriptům z Content-Security-Policy (5. 10. 2026, `src/lib/csp.ts`).
   * Vymýšlí ho `proxy.ts` pro každé načtení stránky. Čtení hlaviček zároveň
   * zajistí, že se **žádná stránka nepředgeneruje** při sestavení — v hotové
   * stránce by byl klíč neplatný a prohlížeč by v ní nespustil nic.
   */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
     * `suppressHydrationWarning` je kvůli přepínači vzhledu: třídu `dark`
     * dopisuje na <html> skript ještě před vykreslením, takže se značka
     * na serveru a v prohlížeči liší. Je to doporučený postup knihovny
     * next-themes a platí jen pro tenhle jeden prvek.
     */
    <html
      lang="cs"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
