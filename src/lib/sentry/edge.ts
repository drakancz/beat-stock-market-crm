import * as Sentry from "@sentry/nextjs";

import { spolecneNastaveni } from "./nastaveni";

/**
 * Hlášení chyb z okrajového běhového prostředí (`proxy.ts`).
 *
 * Platí tu totéž co na serveru — viz `nastaveni.ts`.
 */
Sentry.init(spolecneNastaveni());
