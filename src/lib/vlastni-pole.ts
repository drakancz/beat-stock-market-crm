import { db } from "@/lib/db";

/**
 * Vlastní pole u klienta (Fáze 5B, Jakub 18. 10. 2026).
 *
 * | Kdo           | Smí                                                            |
 * | ------------- | -------------------------------------------------------------- |
 * | uživatel      | vidět a vyplnit hodnoty na kartě klienta, filtrovat seznam     |
 * | administrátor | navíc pole založit, přejmenovat, seřadit a smazat (Nastavení)  |
 * | klient        | nic — vlastní pole nevidí nikdy                                |
 *
 * Smazané pole (`deletedAt`) zmizí z karty i filtrů — **každý dotaz na
 * pole potřebuje `deletedAt: null`**. Hodnoty zůstávají v databázi.
 * Do auditu jde jen název pole, ne hodnota.
 */

export async function nactiPole() {
  return db.clientField.findMany({
    where: { deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true, options: true },
  });
}

/** Pole s hodnotou klienta (nebo `null`) v pořadí z Nastavení. */
export async function nactiPoleKlienta(clientId: string) {
  const [pole, hodnoty] = await Promise.all([
    nactiPole(),
    db.clientFieldValue.findMany({
      where: { clientId, field: { deletedAt: null } },
      select: { fieldId: true, value: true },
    }),
  ]);
  const podlePole = new Map(hodnoty.map((h) => [h.fieldId, h.value]));
  return pole.map((p) => ({ ...p, hodnota: podlePole.get(p.id) ?? null }));
}
