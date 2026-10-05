"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import type { Role } from "@/generated/prisma/enums";

/**
 * Kdo byl přihlášený, když chyba v prohlížeči vznikla.
 *
 * **Jde ven jen vnitřní ID a role** (Jakub, 17. 9. 2026) — nikdy jméno
 * ani e-mail. Podle ID se dá kolega dohledat ve Správě, ale samo o sobě
 * o nikom nic neříká (security_warnings.md, pravidlo 8).
 *
 * Vykresluje se v rámu aplikace, takže platí na všech obrazovkách.
 */
export function SentryUzivatel({ id, role }: { id: string; role: Role }) {
  useEffect(() => {
    Sentry.setUser({ id, role });
    return () => Sentry.setUser(null);
  }, [id, role]);

  return null;
}
