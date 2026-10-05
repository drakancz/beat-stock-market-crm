/**
 * Drobná poznámka pod čarou na konci obrazovky.
 *
 * Nahradila 23. 9. 2026 okno „Zatím jen kostra" (`PhaseNotice`). Jakub
 * ho chtěl pryč — postup projektu vidí v přehledu fází, ne v aplikaci.
 * Kde okno neslo informaci užitečnou pro tým (bez DPH, co se zapisuje do
 * auditu), zůstala tady: bez rámečku a bez nadpisu, ať nepřebíjí obsah.
 * Výhledy „přijde ve fázi X" sem nepatří.
 */
export function PoznamkaPodCarou({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>;
}
