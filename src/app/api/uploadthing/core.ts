import { z } from "zod";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";

import { getViewer } from "@/lib/session";
import { smiNahravat } from "@/lib/soubory";
import { LIMIT_POPIS, MAX_POCET, POVOLENE_TYPY } from "@/lib/soubory-typy";
import { jeUkazka, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";

/**
 * Domluva o nahrání souboru.
 *
 * Soubor putuje z prohlížeče **rovnou k UploadThingu**, ne přes náš
 * server — tak je ta služba postavená. Náš server tu rozhoduje jedinou,
 * zato podstatnou věc: **jestli se vůbec smí nahrávat**. `middleware()`
 * ověří přihlášení, dvoufázové ověření i oprávnění k záznamu, u kterého
 * má soubor viset. Když neprojde, UploadThing nevydá adresu k nahrání
 * a nenahraje se nic (security_warnings.md, pravidlo 5).
 *
 * **Do CRM soubor zapisuje až serverová akce z formuláře**
 * (`prijmiSoubor()` v `src/lib/soubory-prijem.ts`), ne `onUploadComplete`.
 * Důvod je popsaný tam: práci po odeslání odpovědi `next dev` ukončí,
 * takže se obsluha rozeběhla a umřela na prvním čekání. Proto tu
 * `onUploadComplete` jen potvrzuje, že nahrávání skončilo, a
 * `awaitServerData` je vypnuté — formulář nemá na co čekat.
 */

const f = createUploadthing();

/**
 * Co se smí nahrát — pro UploadThing se ze společného seznamu udělá
 * jeho podoba nastavení. Limit i výčet typů jsou tedy na jednom místě
 * (`src/lib/soubory-typy.ts`), ne dvakrát.
 */
const NASTAVENI = Object.fromEntries(
  Object.keys(POVOLENE_TYPY).map((mimeType) => [
    mimeType,
    { maxFileSize: LIMIT_POPIS as "25MB", maxFileCount: MAX_POCET },
  ]),
);

/**
 * U čeho soubor visí. Přichází z prohlížeče, takže se ověřuje zodem
 * (security.md, pravidlo 4) — i když je to jen výběr z pevných hodnot.
 */
const kamSchema = z.object({
  typ: z.enum(["UZIVATEL", "KLIENT"]),
  id: z.string().trim().min(1).max(64),
});

export const souboryRouter = {
  /** Jediná cesta, kterou se do CRM dostane nahraný soubor. */
  prilohy: f(NASTAVENI, { awaitServerData: false })
    .input(kamSchema)
    .middleware(async ({ input }) => {
      if (jeUkazka()) throw new UploadThingError(VYPNUTO_V_UKAZCE);
      const viewer = await getViewer();
      if (!viewer) throw new UploadThingError("Nepřihlášeno.");
      if (viewer.chybiDvoufazove)
        throw new UploadThingError("Nejdřív si zapni dvoufázové ověření.");

      // Oprávnění se ověřuje tady, ne skrytím tlačítka — požadavek jde
      // poslat i mimo formulář.
      if (!(await smiNahravat(viewer, input.typ, input.id))) {
        throw new UploadThingError("Sem soubory nahrávat nemůžeš.");
      }

      return { viewerId: viewer.id, ownerType: input.typ, ownerId: input.id };
    })
    .onUploadComplete(() => {
      // Schválně prázdné. Zapisuje serverová akce z formuláře, která si
      // soubor u úložiště ověří sama.
    }),
} satisfies FileRouter;

export type SouboryRouter = typeof souboryRouter;
