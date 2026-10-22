/**
 * Podmínky a akce vlastních pravidel (Fáze 5D, 2. část, Jakub 19. 10. 2026).
 * Samostatný soubor bez databáze a bez zod — čte ho i formulář v prohlížeči.
 * Ověření je na serveru ve `vlastni-pravidla.ts`.
 *
 * **Všechny podmínky musí platit najednou.** Vyhodnocuje se ráno.
 */

export type Podminka =
  /** Klient má / nemá štítek. */
  | { druh: "stitek"; tagId: string; ma: boolean }
  /** Vlastní pole (výběr nebo ano/ne) má danou hodnotu. */
  | { druh: "pole"; fieldId: string; hodnota: string }
  /** Platí členství, ale N dní bez návštěvy i platby (jako Nechodí). */
  | { druh: "nechodi"; dni: number }
  /** Má zaplacený produkt. */
  | { druh: "koupil"; productId: string }
  /** Členství mu končí do N dní (včetně dneška). */
  | { druh: "konci"; dni: number };

export type Akce =
  /** Úkol vybranému kolegovi s termínem dnes. */
  | { druh: "ukol"; userId: string; nazev: string }
  /** Zpráva do klientské části s upozorněním (jen klient s účtem). */
  | { druh: "zprava"; nadpis: string; text: string }
  /** Přidat nebo odebrat štítek. */
  | { druh: "stitek"; tagId: string; pridat: boolean };

export const DRUHY_PODMINEK: { druh: Podminka["druh"]; popis: string }[] = [
  { druh: "stitek", popis: "Štítek" },
  { druh: "pole", popis: "Vlastní pole" },
  { druh: "nechodi", popis: "Platí, ale nechodí N dní" },
  { druh: "koupil", popis: "Má zaplacený produkt" },
  { druh: "konci", popis: "Členství končí do N dní" },
];

export const DRUHY_AKCI: { druh: Akce["druh"]; popis: string }[] = [
  { druh: "ukol", popis: "Úkol pro kolegu" },
  { druh: "zprava", popis: "Zpráva klientovi" },
  { druh: "stitek", popis: "Štítek přidat / odebrat" },
];

export const MEZE = {
  podminek: 5,
  akci: 3,
  pravidel: 20,
  dniOd: 1,
  dniDo: 365,
  nazevUkolu: 150,
  nadpisZpravy: 80,
  textZpravy: 1000,
} as const;

/** Názvy věcí, na které se pravidlo odkazuje — pro popis v rozhraní. */
export interface Nazvy {
  stitky: Map<string, string>;
  pole: Map<string, string>;
  produkty: Map<string, string>;
  lide: Map<string, string>;
}

const dni = (n: number) => `${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"}`;

export function popisPodminky(p: Podminka, n: Nazvy): string {
  switch (p.druh) {
    case "stitek":
      return `${p.ma ? "má" : "nemá"} štítek ${n.stitky.get(p.tagId) ?? "(smazaný)"}`;
    case "pole":
      return `${n.pole.get(p.fieldId) ?? "(smazané pole)"} = ${p.hodnota}`;
    case "nechodi":
      return `platí, ale ${dni(p.dni)} bez návštěvy i platby`;
    case "koupil":
      return `má zaplacený produkt ${n.produkty.get(p.productId) ?? "(smazaný)"}`;
    case "konci":
      return `členství končí do ${dni(p.dni)}`;
  }
}

export function popisAkce(a: Akce, n: Nazvy): string {
  switch (a.druh) {
    case "ukol":
      return `úkol „${a.nazev}“ pro ${n.lide.get(a.userId) ?? "(nikoho)"}`;
    case "zprava":
      return `zpráva klientovi „${a.nadpis}“`;
    case "stitek":
      return `${a.pridat ? "přidat" : "odebrat"} štítek ${n.stitky.get(a.tagId) ?? "(smazaný)"}`;
  }
}
