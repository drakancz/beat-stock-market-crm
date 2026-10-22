import type { TagColor } from "@/generated/prisma/enums";

/**
 * Barvy štítků (Fáze 5B, 11. 10. 2026) — jen odstíny, které značka už má
 * v `globals.css`, žádná barva napsaná natvrdo. Bez databáze, ať je může
 * použít i prohlížeč.
 */
export const BARVY_STITKU: Record<TagColor, { nazev: string; tridy: string }> = {
  ZAKLADNI: { nazev: "Šedá", tridy: "bg-secondary text-secondary-foreground border-border" },
  ZNACKA: { nazev: "Modrá", tridy: "bg-primary/10 text-primary border-primary/25" },
  ZELENA: {
    nazev: "Zelená",
    tridy: "bg-pristup-ano text-pristup-ano-foreground border-pristup-ano-foreground/25",
  },
  JANTAR: {
    nazev: "Jantarová",
    tridy: "bg-konec-clenstvi text-konec-clenstvi-foreground border-konec-clenstvi-foreground/25",
  },
  CERVENA: { nazev: "Červená", tridy: "bg-destructive/10 text-destructive border-destructive/25" },
};

export const PORADI_BAREV: TagColor[] = ["ZAKLADNI", "ZNACKA", "ZELENA", "JANTAR", "CERVENA"];
