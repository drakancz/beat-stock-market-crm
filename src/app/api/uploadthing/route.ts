import { after } from "next/server";
import { createRouteHandler } from "uploadthing/next";

import { souboryRouter } from "./core";

/**
 * Adresa, se kterou se domlouvá nahrávání souborů.
 *
 * Kdo co smí, se kontroluje v `core.ts` — tady je jen napojení knihovny.
 * Bez tokenu (`UPLOADTHING_TOKEN`) adresa nahrávání odmítne; aplikace
 * kvůli tomu nespadne, jen se v rozhraní neukáže tlačítko Nahrát
 * (`jeNahravaniZapnute()` v `src/lib/soubory.ts`).
 *
 * `handleDaemonPromise` jde přes `after()`, protože knihovna po odeslání
 * odpovědi ještě dokončuje domluvu s UploadThingem a Next.js by tu práci
 * jinak ukončil. Na zapsání přílohy to nestačí — to proto dělá serverová
 * akce z formuláře (`src/lib/soubory-prijem.ts`).
 */
export const { GET, POST } = createRouteHandler({
  router: souboryRouter,
  config: {
    handleDaemonPromise: (praceNaPozadi) => after(praceNaPozadi),
  },
});
