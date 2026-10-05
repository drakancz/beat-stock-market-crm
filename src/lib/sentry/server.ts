import * as Sentry from "@sentry/nextjs";

import { spolecneNastaveni } from "./nastaveni";

/**
 * Hlášení chyb ze serveru. Načítá se z `src/instrumentation.ts` při startu.
 *
 * Co se smí a nesmí posílat, je v `nastaveni.ts` — hlavně: žádná jména,
 * e-maily ani telefony.
 */
Sentry.init(spolecneNastaveni());
