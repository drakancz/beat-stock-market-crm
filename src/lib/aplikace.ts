import type { MetadataRoute } from "next";

/**
 * Aplikace na ploše telefonu (krok 3A, Jakub 4. 10. 2026) — klientská
 * část i CRM týmu se dají přidat na plochu a otevírají se bez lišty
 * prohlížeče. Jsou to **dvě oddělené aplikace** s vlastním názvem,
 * rozsahem a úvodní stránkou; každá otevře jen svou část.
 *
 * Manifest se vydává přes obsluhu adresy (`aplikace.webmanifest/route.ts`),
 * ne přes souborovou konvenci `app/manifest.ts` — ta by platila pro celý
 * web a klientská část by si nemohla určit vlastní.
 *
 * Barvy jsou napevno, protože manifest proměnné z `globals.css` neumí:
 * modrá je `--primary` a papír `--background` ze světlého režimu (stejně
 * jako v `src/app/icon.svg`). Při změně palety změň i tohle.
 */

const MODRA = "#1d3f7a";
const PAPIR = "#fdfcfa";

const IKONY: MetadataRoute.Manifest["icons"] = [
  { src: "/ikona-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/ikona-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/ikona-maskovatelna-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export type DruhAplikace = "crm" | "klient";

export function manifestAplikace(druh: DruhAplikace): MetadataRoute.Manifest {
  const spolecne = {
    display: "standalone",
    orientation: "portrait",
    lang: "cs",
    dir: "ltr",
    background_color: PAPIR,
    theme_color: MODRA,
    icons: IKONY,
  } satisfies Partial<MetadataRoute.Manifest>;

  if (druh === "klient") {
    return {
      ...spolecne,
      id: "/ucet",
      name: "Beat Stock Market",
      short_name: "Beat Stock",
      description: "Vaše objednávky, členství a zprávy od Beat Stock Market.",
      start_url: "/ucet",
      scope: "/ucet",
    };
  }

  return {
    ...spolecne,
    id: "/dashboard",
    name: "CRM Beat Stock Market",
    short_name: "BSM CRM",
    description: "Interní systém Beat Stock Market.",
    start_url: "/dashboard",
    scope: "/",
  };
}

/** Odpověď s manifestem — vlastní typ obsahu, ať ho prohlížeč pozná. */
export function odpovedManifestu(druh: DruhAplikace): Response {
  return new Response(JSON.stringify(manifestAplikace(druh)), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
