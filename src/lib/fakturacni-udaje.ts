import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Fakturační údaje klienta (Jakub, 19. 10. 2026) — nepovinné. Posílá je
 * Landing Page s objednávkou (`fakturacni`) a klient si je upraví v Mém
 * profilu. Bez adresy vzniká zjednodušený daňový doklad (do 10 000 Kč).
 * Na faktuře se opíšou ve chvíli vystavení — pozdější změna starou fakturu
 * nepřepíše.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Údaj je příliš dlouhý.")
    .transform((hodnota) => hodnota || null);

export const fakturacniSchema = z
  .object({
    nazev: text(200).optional(),
    ulice: text(200).optional(),
    mesto: text(100).optional(),
    psc: text(20).optional(),
    zeme: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{2})?$/, "Zemi zadejte dvoupísmenným kódem (CZ, SK…).")
      .transform((hodnota) => hodnota || null)
      .optional(),
    ico: z
      .string()
      .trim()
      .regex(/^(\d{8})?$/, "IČO má osm číslic.")
      .transform((hodnota) => hodnota || null)
      .optional(),
    dic: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{2}[0-9A-Z]{2,12})?$/, "DIČ zadejte i s kódem země, třeba CZ12345678.")
      .transform((hodnota) => hodnota || null)
      .optional(),
  })
  .strict();

export type FakturacniUdaje = z.infer<typeof fakturacniSchema>;

/** Údaje ve tvaru sloupců klienta. Chybějící klíč = beze změny. */
export function sloupceFakturace(udaje: FakturacniUdaje): Prisma.ClientUpdateInput {
  return {
    ...(udaje.nazev !== undefined ? { billingName: udaje.nazev } : {}),
    ...(udaje.ulice !== undefined ? { billingStreet: udaje.ulice } : {}),
    ...(udaje.mesto !== undefined ? { billingCity: udaje.mesto } : {}),
    ...(udaje.psc !== undefined ? { billingZip: udaje.psc } : {}),
    ...(udaje.zeme !== undefined ? { billingCountry: udaje.zeme } : {}),
    ...(udaje.ico !== undefined ? { billingIco: udaje.ico } : {}),
    ...(udaje.dic !== undefined ? { billingDic: udaje.dic } : {}),
  };
}
