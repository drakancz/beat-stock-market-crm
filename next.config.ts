import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Produkční image nese jen to, co je opravdu potřeba — bez node_modules.
  output: "standalone",

  /*
   * Vypnutý vývojářský ukazatel Next.js.
   *
   * Sedí vlevo dole, tedy přesně přes jméno přihlášeného uživatele
   * v menu, a po kliknutí otevře panel s údaji o vykreslování stránky.
   * Kdo aplikaci jen zkouší, si ho splete s její součástí.
   *
   * Chyby při překladu i za běhu se ukazují dál — vypíná se jen tenhle
   * odznak. V produkci se stejně nezobrazuje.
   */
  devIndicators: false,

  // Neprozrazovat, na čem aplikace běží (bezpečnostní audit, 16. 9. 2026).
  poweredByHeader: false,

  /*
   * PDF certifikátu (Fáze 5C, 11. 10. 2026). `pdfkit` si čte vlastní
   * datové soubory přes `__dirname`, což po zabalení do serverového
   * balíku přestane sedět — proto běží z `node_modules` tak, jak je.
   * Písma certifikátu čte `certifikat-pdf.ts` z disku; standalone
   * sestavení je samo nepřibalí, tak se mu musí říct.
   */
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/ucet/certifikat/*": ["src/lib/vzdelavani/pisma/*.ttf"],
    // Faktury a dobropisy v PDF (19. 10. 2026) — stejná písma.
    "/ucet/faktura/*": ["src/lib/vzdelavani/pisma/*.ttf"],
    "/objednavky/faktura/*": ["src/lib/vzdelavani/pisma/*.ttf"],
    // Moje údaje v PDF (21. 10. 2026).
    "/ucet/moje-udaje.pdf": ["src/lib/vzdelavani/pisma/*.ttf"],
  },

  /*
   * Bezpečnostní hlavičky pro všechny odpovědi (bezpečnostní audit,
   * Jakub, 16. 9. 2026).
   *
   * - Zákaz vložení do cizí stránky (`X-Frame-Options` i CSP
   *   `frame-ancestors`). Jinak by cizí web mohl CRM načíst do neviditelného
   *   rámu a podstrčit přihlášenému kliknutí — třeba na mazání.
   * - `nosniff`: prohlížeč nehádá typ souboru podle obsahu.
   * - `Referrer-Policy: same-origin`: cizí web (loga brokerů) se nedozví,
   *   ze které stránky CRM na něj prohlížeč sahá.
   * - `Permissions-Policy`: kamera, mikrofon ani poloha se nepoužívají.
   *
   * Plná Content-Security-Policy (omezení skriptů, rámů, odesílání dat)
   * je od 5. 10. 2026 na **stránkách** — nastavuje ji `proxy.ts` podle
   * `src/lib/csp.ts`, protože potřebuje nový klíč ke skriptům pro každé
   * načtení, a hlavičku odsud tím nahradí. Tady zůstává `frame-ancestors`
   * pro adresy, kterými proxy neprochází (API, manifesty, ikony).
   * `Strict-Transport-Security` patří až k HTTPS na serveru, do reverzní
   * proxy.
   */
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      /*
       * Výjimka pro výdej nahraných souborů (Jakub, 21. 9. 2026): náhled
       * PDF a obrázků se ukazuje v okně přímo v CRM, což znamená vložit
       * soubor do rámu na naší vlastní stránce. Celoaplikační `DENY` to
       * zakazuje i nám samotným, proto je tu `SAMEORIGIN`. Cizí web si
       * CRM ani soubor do sebe pořád vložit nemůže.
       *
       * Přesnější hlavičky (podle druhu souboru) nastavuje sama obsluha
       * `src/app/api/soubory/[id]/route.ts` — tohle je jen zvednutí
       * celoaplikačního zákazu.
       */
      {
        source: "/api/soubory/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      /*
       * Service worker klientské části (krok 3A, 4. 10. 2026). Prohlížeč
       * ho má pokaždé ověřit u serveru, ať se oprava dostane k lidem hned,
       * a skript smí sahat jen na naši adresu.
       */
      {
        source: "/sw-klient.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

/**
 * Hlášení chyb do Sentry (Jakub, 17. 9. 2026).
 *
 * Obal zapojí Sentry do sestavení. Co se smí posílat, řeší
 * `src/lib/sentry/nastaveni.ts` — hlavně: žádná jména, e-maily ani
 * telefony (security_warnings.md, pravidlo 8).
 *
 * - **`tunnelRoute` se nepoužívá.** Vytvořilo by v aplikaci adresu bez
 *   přihlášení, kterou by šlo posílat data kamkoli; seznam takových
 *   adres je v `security.md` a nerozšiřuje se kvůli pohodlí.
 * - **Mapy zdrojového kódu se posílají jen tehdy, když je při sestavení
 *   k dispozici `SENTRY_AUTH_TOKEN`** (Jakub, 17. 9. 2026 — chtěl
 *   v hlášení čitelný název souboru a řádek). Bez klíče se sestavení
 *   normálně dokončí, jen budou chyby hůř čitelné. Mapy se po odeslání
 *   z výsledku mažou, takže je aplikace nevydává do prohlížeče.
 * - **Telemetrie Sentry je vypnutá** — o našem sestavení se ven nic
 *   neposílá.
 *
 * Volby `disableLogger` a `reactComponentAnnotation` tu schválně nejsou:
 * v Sentry 10 byly zastaralé a s Turbopackem, který Next.js 16 používá,
 * stejně nefungují.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,

  // Kam mapy patří. Účet je v EU, proto `sentryUrl` — bez něj by se
  // nástroj na odeslání hlásil na americký server a odeslání by selhalo.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  sentryUrl: process.env.SENTRY_URL,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  sourcemaps: {
    // Bez klíče se nic neposílá a sestavení projde — tak běží vývoj,
    // testy i sestavení u kohokoli, kdo klíč nemá.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Mapy po odeslání zmizí z `.next`, ať se nedostanou do obrazu
    // a přes něj k návštěvníkům.
    deleteSourcemapsAfterUpload: true,
  },
  // `widenClientFileUpload` Sentry 11 zrušilo; posílají se jen mapy
  // vlastního kódu, jako dřív s `false`.
});
