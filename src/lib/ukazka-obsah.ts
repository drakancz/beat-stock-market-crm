/**
 * Texty ukázkového vzdělávání — kurzy, lekce, kvízy, články a webináře
 * (Jakub, 22. 10. 2026; texty Jakub schválil týž den — změny znovu ke schválení).
 *
 * **Vzdělávání, ne doporučení** (security_warnings.md, pravidlo 9): žádný
 * konkrétní titul ke koupi, žádné „teď je dobrá doba“, žádné sliby výnosu.
 * Text je prostý — odstavce oddělené prázdným řádkem (`ObsahVzdelavani`).
 */

export interface UkazkovaLekce {
  title: string;
  body: string;
  kviz?: { otazka: string; moznosti: string[]; spravna: number }[];
}

export interface UkazkovyKurz {
  /** Název produktu z ceníku (`src/lib/ukazka-zaklad.ts`), ke kterému kurz patří. */
  produkt: string;
  title: string;
  description: string;
  lekce: UkazkovaLekce[];
}

const UPOZORNENI =
  "Obsah je vzdělávací a vymyšlený pro ukázku. Nejde o investiční doporučení.";

export const UKAZKOVE_KURZY: UkazkovyKurz[] = [
  {
    produkt: "Kurz Základy investování",
    title: "Základy investování",
    description:
      "Pět krátkých lekcí pro úplné začátečníky: co je akcie, jak spolu souvisí riziko a výnos, proč rozkládat peníze a jak číst poplatky.",
    lekce: [
      {
        title: "Co je akcie a jak funguje burza",
        body: `Akcie je malý podíl na firmě. Kdo ji vlastní, má nárok na část zisku (pokud ho firma vyplácí jako dividendu) a může hlasovat na valné hromadě.

Burza je místo, kde se kupující a prodávající potkávají. Cena akcie není „správná“ ani „špatná“ — je to poslední cena, za kterou se někdo s někým dohodl.

Proto se cena mění každou minutu: odráží očekávání tisíců lidí, ne jen výsledky firmy.

${UPOZORNENI}`,
      },
      {
        title: "Riziko a výnos",
        body: `Vyšší možný výnos skoro vždy znamená vyšší riziko. Spořicí účet nekolísá, ale vydělá málo; akcie kolísají a mohou i dlouho ztrácet.

Riziko není jen „můžu prodělat“. Je to hlavně nejistota — jak moc se hodnota cestou hýbe a jestli to vydržíte bez paniky.

Než do čehokoli vložíte peníze, odpovězte si: na jak dlouho je nepotřebuji a jaký pokles byste v klidu unesli?

${UPOZORNENI}`,
        kviz: [
          {
            otazka: "Co obvykle platí mezi rizikem a možným výnosem?",
            moznosti: [
              "Vyšší možný výnos bývá spojený s vyšším rizikem.",
              "Vyšší výnos znamená nižší riziko.",
              "Riziko a výnos spolu nesouvisejí.",
            ],
            spravna: 0,
          },
          {
            otazka: "Co je dobré si ujasnit ještě před investováním?",
            moznosti: [
              "Na jak dlouho peníze nebudu potřebovat.",
              "Které akcie minulý týden nejvíc rostly.",
              "Nic, stačí začít.",
            ],
            spravna: 0,
          },
        ],
      },
      {
        title: "Proč nedávat všechna vejce do jednoho košíku",
        body: `Diverzifikace znamená rozložit peníze mezi víc věcí — firmy, odvětví, země nebo druhy aktiv.

Když se jedné části nedaří, ostatní to mohou vyrovnat. Diverzifikace nezaručí zisk, ale snižuje dopad jednoho špatného rozhodnutí.

Pozor na „falešnou“ diverzifikaci: deset firem z jednoho odvětví je pořád jeden košík.

${UPOZORNENI}`,
      },
      {
        title: "Poplatky, které nejsou vidět",
        body: `Poplatek za nákup je jen jeden z mnoha. Další bývají za vedení účtu, za převod měny nebo roční poplatek fondu.

Jedno procento ročně vypadá málo, ale za dvacet let z výsledku ukrojí znatelnou část.

Než si vyberete brokera nebo fond, sepište si všechny poplatky na jeden papír a spočítejte je na rok.

${UPOZORNENI}`,
      },
      {
        title: "Investiční deník",
        body: `Zapisujte si, co jste koupili nebo prodali, kdy, za kolik — a hlavně proč.

Po roce si deník přečtěte. Uvidíte, která rozhodnutí byla promyšlená a která udělal strach nebo nadšení.

Deník je nejlevnější učitel: učí z vašich vlastních chyb, ne z cizích rad.

${UPOZORNENI}`,
        kviz: [
          {
            otazka: "Co je v investičním deníku nejdůležitější zapsat?",
            moznosti: ["Proč se tak rozhoduji.", "Jen cenu nákupu.", "Názor kamaráda."],
            spravna: 0,
          },
        ],
      },
    ],
  },
  {
    produkt: "Kurz Technická analýza",
    title: "Technická analýza bez kouzel",
    description:
      "Jak číst graf ceny, co jsou trend, podpora a odpor — a proč žádný ukazatel neumí předpovědět budoucnost.",
    lekce: [
      {
        title: "Svíčkový graf",
        body: `Každá „svíčka“ ukazuje jedno období: cenu na začátku, na konci, nejvyšší a nejnižší.

Tělo svíčky je rozdíl mezi začátkem a koncem, knoty ukazují, kam se cena během období dostala.

Graf je záznam minulosti. Pomáhá pochopit, co se dělo, ne co se stane.

${UPOZORNENI}`,
      },
      {
        title: "Trend, podpora a odpor",
        body: `Trend je směr, kterým se cena delší dobu pohybuje. Podpora je úroveň, kde se pokles dřív zastavil; odpor úroveň, kde se zastavil růst.

Tyhle úrovně nejsou zákon. Jsou to místa, kde si hodně lidí všimlo stejné ceny — a proto na ni reagují.

${UPOZORNENI}`,
        kviz: [
          {
            otazka: "Co je podpora v grafu?",
            moznosti: [
              "Úroveň, kde se pokles ceny dřív zastavil.",
              "Záruka, že cena dál neklesne.",
              "Doporučení k nákupu.",
            ],
            spravna: 0,
          },
        ],
      },
      {
        title: "Proč žádný ukazatel nic nezaručí",
        body: `Ukazatelé (indikátory) přepočítávají minulé ceny do jiné podoby. Nemají informaci, kterou by graf už neobsahoval.

Kdo hledá ukazatel, který „vždy funguje“, hledá něco, co neexistuje. Technická analýza je nástroj na přemýšlení o riziku, ne věštba.

${UPOZORNENI}`,
      },
    ],
  },
];

export interface UkazkovyClanek {
  title: string;
  body: string;
  /** Před kolika dny vyšel. */
  predDny: number;
}

export const UKAZKOVE_CLANKY: UkazkovyClanek[] = [
  {
    title: "Jak číst výroční zprávu za 15 minut",
    predDny: 3,
    body: `Výroční zpráva má desítky stran, ale pro první představu stačí tři místa: tržby, zisk a dluh — a jak se měnily za posledních pět let.

Hledejte trend, ne jedno číslo. Jeden výborný rok může být náhoda, pět let v řadě už vypovídá víc.

${UPOZORNENI}`,
  },
  {
    title: "Inflace a úroky: co dělají s úsporami",
    predDny: 10,
    body: `Inflace znamená, že za stejné peníze si koupíte méně. Úspory, které rostou pomaleji než inflace, ve skutečnosti ztrácejí.

Úroková sazba centrální banky ovlivňuje úroky na spořicích účtech i hypotékách. Rozumět jí pomáhá chápat zprávy, ne předvídat trh.

${UPOZORNENI}`,
  },
  {
    title: "Psychologie: proč prodáváme ve strachu",
    predDny: 24,
    body: `Ztráta bolí víc, než kolik potěší stejně velký zisk. Proto lidé často prodávají ve chvíli největšího strachu.

Pomáhá mít plán sepsaný dopředu, v klidu: kdy a proč byste prodali. V panice se pak rozhoduje podle papíru, ne podle emocí.

${UPOZORNENI}`,
  },
];

export interface UkazkovyWebinar {
  title: string;
  description: string;
  /** Za kolik dní začíná (záporné = proběhl). */
  zaDny: number;
  hodina: number;
  audience: "VSICHNI" | "CLENOVE";
}

export const UKAZKOVE_WEBINARE: UkazkovyWebinar[] = [
  {
    title: "Otevřený webinář: Jak začít bez stresu",
    description: "Hodina o tom, jak si ujasnit cíle a riziko ještě před prvním nákupem.",
    zaDny: 4,
    hodina: 19,
    audience: "VSICHNI",
  },
  {
    title: "Klubový večer: Otázky a odpovědi",
    description: "Pro členy Klubu — ptáte se vy, odpovídá lektor. Bez tipů na nákup.",
    zaDny: 11,
    hodina: 20,
    audience: "CLENOVE",
  },
  {
    title: "Jak číst graf (záznam)",
    description: "Proběhlý webinář k lekcím technické analýzy.",
    zaDny: -6,
    hodina: 19,
    audience: "VSICHNI",
  },
];
