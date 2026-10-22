/**
 * Kroky průvodce ukázkou „Co si tu vyzkoušet“ (Jakub, 22. 10. 2026),
 * zvlášť od komponenty, aby je mohly číst i testy.
 */

export type KrokPruvodce = {
  /** Adresa kroku; krok je prošlý po otevření `cesta` nebo cokoli pod ní. */
  href: string;
  cesta: string;
  /** Jen přesně tahle adresa, ne stránky pod ní (úvod klientské části). */
  presne?: boolean;
  nazev: string;
  popis: string;
};

export type DruhPruvodce = "tym" | "klient";

export const KROKY_PRUVODCE: Record<DruhPruvodce, KrokPruvodce[]> = {
  tym: [
    {
      href: "/dashboard",
      cesta: "/dashboard",
      nazev: "Přehled firmy",
      popis: "Tržby, nové objednávky a členství, které končí — za zvolené období.",
    },
    {
      href: "/klienti?hledat=Eva",
      cesta: "/klienti/",
      nazev: "Karta klienta",
      popis: "Otevřete Evu Malou: objednávky, kurzy, časová osa, poznámky a štítky.",
    },
    {
      href: "/objednavky",
      cesta: "/objednavky",
      nazev: "Objednávky a faktury",
      popis: "Přepněte objednávku na Zaplaceno — vznikne faktura a prodlouží se členství.",
    },
    {
      href: "/vzdelavani",
      cesta: "/vzdelavani",
      nazev: "Vzdělávání",
      popis: "Kurzy, lekce s kvízy, webináře a články pro klienty.",
    },
    {
      href: "/pravidla",
      cesta: "/pravidla",
      nazev: "Automatická pravidla",
      popis: "Co se stane samo — štítek po zaplacení, úkol před koncem členství.",
    },
  ],
  klient: [
    {
      href: "/ucet",
      cesta: "/ucet",
      presne: true,
      nazev: "Přehled klienta",
      popis: "Členství, rozpracovaný kurz a odznaky na jednom místě.",
    },
    {
      href: "/ucet/kurzy",
      cesta: "/ucet/kurzy",
      nazev: "Kurz a kvíz",
      popis: "Pokračujte v lekci a vyzkoušejte kvíz — dostanete odznak.",
    },
    {
      href: "/ucet/koupit",
      cesta: "/ucet/koupit",
      nazev: "Nákup",
      popis: "Objednávka s QR kódem k převodu; v ukázce se nic neplatí.",
    },
    {
      href: "/ucet/konzultace",
      cesta: "/ucet/konzultace",
      nazev: "Rezervace konzultace",
      popis: "Vyberte volný termín a zase ho zrušte.",
    },
    {
      href: "/ucet/profil",
      cesta: "/ucet/profil",
      nazev: "Moje údaje",
      popis: "Stáhněte si všechno, co o vás systém ví, jako PDF nebo JSON.",
    },
  ],
};
