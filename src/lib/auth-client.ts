"use client";

export { signIn, signOut, useSession } from "next-auth/react";

/**
 * Přihlašování na straně prohlížeče.
 *
 * Používá se jen tam, kde uživatel něco vyplňuje — přihlašovací formulář
 * a odhlášení. **Nikdy se z něj nerozhoduje o tom, co kdo smí vidět.**
 * To se vyhodnocuje výhradně na serveru (`src/lib/session.ts` a dotazy
 * v `src/lib/queries.ts`).
 */
