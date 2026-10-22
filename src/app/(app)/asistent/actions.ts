"use server";

import { z } from "zod";

import { zeptejSe, type VysledekOtazky } from "@/lib/asistent/asistent";
import { requireAdmin } from "@/lib/session";

/**
 * Otázka na asistenta AI (krok 4, Jakub 10. 10. 2026).
 *
 * **Jen administrátor** — `requireAdmin()` vrací ostatním 404. Rozhovor
 * posílá prohlížeč celý (neukládá se na serveru); délka je omezená, ať
 * se nedá poslat libovolně velký požadavek k AI.
 */
const zpravySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(4000),
    }),
  )
  .min(1)
  .max(30)
  .refine((zpravy) => zpravy[0]?.role === "user" && zpravy.at(-1)?.role === "user", {
    message: "Rozhovor začíná i končí otázkou.",
  });

export async function zeptejSeAsistenta(zpravy: unknown): Promise<VysledekOtazky> {
  const viewer = await requireAdmin();
  const vstup = zpravySchema.safeParse(zpravy);
  if (!vstup.success) {
    return { ok: false, chyba: "Otázka je prázdná nebo moc dlouhá.", zbyva: -1 };
  }
  return zeptejSe(viewer, vstup.data);
}
