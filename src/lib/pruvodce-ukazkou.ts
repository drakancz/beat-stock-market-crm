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
  /** Totéž anglicky (src/lib/jazyk.ts). */
  en: { nazev: string; popis: string };
};

export type DruhPruvodce = "tym" | "klient";

export const KROKY_PRUVODCE: Record<DruhPruvodce, KrokPruvodce[]> = {
  tym: [
    {
      href: "/dashboard",
      cesta: "/dashboard",
      nazev: "Přehled firmy",
      popis: "Tržby, nové objednávky a členství, které končí — za zvolené období.",
      en: {
        nazev: "Company overview",
        popis: "Revenue, new orders and memberships about to expire, for the selected period.",
      },
    },
    {
      href: "/klienti?hledat=Eva",
      cesta: "/klienti/",
      nazev: "Karta klienta",
      popis: "Otevřete Evu Malou: objednávky, kurzy, časová osa, poznámky a štítky.",
      en: {
        nazev: "Client record",
        popis: "Open Eva Malá: orders, courses, timeline, notes and tags.",
      },
    },
    {
      href: "/objednavky",
      cesta: "/objednavky",
      nazev: "Objednávky a faktury",
      popis: "Přepněte objednávku na Zaplaceno — vznikne faktura a prodlouží se členství.",
      en: {
        nazev: "Orders and invoices",
        popis:
          "Switch an order to Paid (Zaplaceno): an invoice is issued and the membership is extended.",
      },
    },
    {
      href: "/vzdelavani",
      cesta: "/vzdelavani",
      nazev: "Vzdělávání",
      popis: "Kurzy, lekce s kvízy, webináře a články pro klienty.",
      en: {
        nazev: "Education",
        popis: "Courses, lessons with quizzes, webinars and articles for clients.",
      },
    },
    {
      href: "/pravidla",
      cesta: "/pravidla",
      nazev: "Automatická pravidla",
      popis: "Co se stane samo — štítek po zaplacení, úkol před koncem členství.",
      en: {
        nazev: "Automation rules",
        popis: "What happens on its own: a tag after payment, a task before a membership ends.",
      },
    },
  ],
  klient: [
    {
      href: "/ucet",
      cesta: "/ucet",
      presne: true,
      nazev: "Přehled klienta",
      popis: "Členství, rozpracovaný kurz a odznaky na jednom místě.",
      en: {
        nazev: "Client overview",
        popis: "Membership, the course in progress and badges in one place.",
      },
    },
    {
      href: "/ucet/kurzy",
      cesta: "/ucet/kurzy",
      nazev: "Kurz a kvíz",
      popis: "Pokračujte v lekci a vyzkoušejte kvíz — dostanete odznak.",
      en: {
        nazev: "Course and quiz",
        popis: "Continue the lesson and try the quiz to earn a badge.",
      },
    },
    {
      href: "/ucet/koupit",
      cesta: "/ucet/koupit",
      nazev: "Nákup",
      popis: "Objednávka s QR kódem k převodu; v ukázce se nic neplatí.",
      en: {
        nazev: "Purchase",
        popis: "An order with a QR code for bank transfer; nothing is charged in the demo.",
      },
    },
    {
      href: "/ucet/konzultace",
      cesta: "/ucet/konzultace",
      nazev: "Rezervace konzultace",
      popis: "Vyberte volný termín a zase ho zrušte.",
      en: { nazev: "Book a consultation", popis: "Pick a free slot and cancel it again." },
    },
    {
      href: "/ucet/profil",
      cesta: "/ucet/profil",
      nazev: "Moje údaje",
      popis: "Stáhněte si všechno, co o vás systém ví, jako PDF nebo JSON.",
      en: {
        nazev: "My data",
        popis: "Download everything the system knows about you as PDF or JSON.",
      },
    },
  ],
};
