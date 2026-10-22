/**
 * Hotová pravidla „když se stane X, udělej Y“ (Fáze 5D, Jakub 18. 10. 2026)
 * — id a popisy bez přístupu k databázi, ať je použije i stránka.
 * Nechodí → úkol „Ozvat se“ zaniklo 20. 10. 2026 (Jakub).
 */

export const PRAVIDLA = ["nechodi-zprava", "lekce-oznameni", "zaplaceno-stitek"] as const;

export type IdPravidla = (typeof PRAVIDLA)[number];

export const POPIS_PRAVIDLA: Record<IdPravidla, { nazev: string; kdy: string; co: string }> = {
  "nechodi-zprava": {
    nazev: "Nechodí → zpráva klientovi",
    kdy: "Člen s účtem v klientské části dostane značku Nechodí.",
    co: "Klient dostane zprávu (oznámení, jinak e-mail) a najde ji ve Zprávách. Jednou, dokud znovu nepřijde.",
  },
  "lekce-oznameni": {
    nazev: "Odemčená lekce → oznámení",
    kdy: "Lekce se klientovi otevřela podle dnů po zakoupení nebo data.",
    co: "Ráno přijde oznámení „Otevřela se vám nová lekce“. Každá lekce jednou.",
  },
  "zaplaceno-stitek": {
    nazev: "Zaplaceno → štítek",
    kdy: "Klient zaplatí vybraný produkt.",
    co: "Klient hned dostane vybraný štítek. Když ho kolega odebere, znovu se nepřidá.",
  },
};

/** Jak se pozná, že pravidlo udělalo něco u klienta — pro časovou osu. */
export const NADPIS_NA_OSE: Record<IdPravidla, string> = {
  "nechodi-zprava": "Pravidlo: zpráva Nechodí",
  "lekce-oznameni": "Pravidlo: oznámení o otevřené lekci",
  "zaplaceno-stitek": "Pravidlo: štítek po zaplacení",
};
