import * as Sentry from "@sentry/nextjs";

import { spolecneNastaveni } from "@/lib/sentry/nastaveni";

/**
 * Hlášení chyb z prohlížeče (Jakub, 17. 9. 2026).
 *
 * Next.js tenhle soubor načte sám na začátku každé návštěvy. **Nahrávání
 * obrazovky (Session Replay) tu schválně není** — nahrálo by jména
 * a telefony klientů (security_warnings.md, pravidlo 8).
 *
 * Kdo je přihlášený, doplňuje rám aplikace (`src/components/sentry-uzivatel.tsx`)
 * — jen vnitřní ID a role.
 */
Sentry.init(spolecneNastaveni());

/** Aby Sentry poznalo přechody mezi stránkami uvnitř aplikace. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
