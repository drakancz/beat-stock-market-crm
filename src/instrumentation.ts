/**
 * Kontrola při startu serveru (Jakub, 16. 9. 2026 — bezpečnostní audit).
 *
 * `register()` volá Next.js jednou při startu, dřív než server přijme první
 * požadavek. **S nepoužitelným `AUTH_SECRET` aplikace nenaběhne**: tímhle
 * tajemstvím se podepisují přihlášení, a kdyby na serveru zůstala zástupná
 * hodnota z `.env.example` (je veřejně v repozitáři), dal by si kdokoli
 * vyrobit platné přihlášení. Spadnout hned je lepší než běžet nechráněně.
 *
 * Při `next build` se nekontroluje — sestavení image tajemství nemá a mít
 * nemá (security_warnings.md, pravidlo 3).
 */

import * as Sentry from "@sentry/nextjs";

const MIN_DELKA = 32;

export async function register() {
  // Hlášení chyb do Sentry (Jakub, 17. 9. 2026). Bez DSN a mimo produkci
  // se nezapne — podrobnosti v `src/lib/sentry/nastaveni.ts`.
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/sentry/server");
  if (process.env.NEXT_RUNTIME === "edge") await import("./lib/sentry/edge");

  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const tajemstvi = process.env.AUTH_SECRET?.trim() ?? "";

  if (tajemstvi.length < MIN_DELKA || tajemstvi.startsWith("zmen-me")) {
    throw new Error(
      "AUTH_SECRET chybí, je kratší než 32 znaků, nebo je to zástupná hodnota z .env.example. " +
        "Vygeneruj vlastní: openssl rand -base64 32",
    );
  }
}

/**
 * Chyba při zpracování požadavku (stránka, serverová akce, obsluha adresy).
 *
 * Next.js tuhle funkci volá sám a Sentry z ní udělá hlášení. Osobní údaje
 * z něj vyhodí `ocistiUdalost()` v `src/lib/sentry/nastaveni.ts`.
 */
export const onRequestError = Sentry.captureRequestError;
