/**
 * Oslovení jménem v 5. pádu.
 *
 * „Ahoj Jakube" místo „Ahoj Jakub". Čeština tady nemá jednoduché pravidlo,
 * ale drtivá většina křestních jmen se řídí koncovkou — a zbytek řeší
 * seznam výjimek níž.
 *
 * **Když si systém není jistý, nechá jméno beze změny.** Nesklonění je
 * nepříjemné, ale špatné sklonění je horší: „Ahoj Dagmře" člověka urazí
 * víc než „Ahoj Dagmar".
 *
 * Kdyby některé jméno vycházelo špatně, přidá se do `VYJIMKY` — je to
 * jediné místo, kam se kvůli tomu sahá.
 */

/**
 * Jména, u kterých pravidla selhávají.
 *
 * Jsou to hlavně ženská jména zakončená na souhlásku (ta se neskloňují,
 * ale pravidla by je vzala jako mužská) a mužská jména se změnou kmene.
 */
const VYJIMKY: Record<string, string> = {
  // Ženská jména na souhlásku — zůstávají beze změny.
  dagmar: "Dagmar",
  miriam: "Miriam",
  ester: "Ester",
  karin: "Karin",
  ingrid: "Ingrid",
  nikol: "Nikol",
  rút: "Rút",
  ruth: "Ruth",
  doris: "Doris",
  iris: "Iris",
  sarah: "Sarah",

  // Mužská jména, kde se mění kmen.
  zdeněk: "Zdeňku",
  luděk: "Luďku",
  vaněk: "Vaňku",
  havel: "Havle",
  karel: "Karle",
  pavel: "Pavle",
  bedřich: "Bedřichu",

  // Jména, která se neskloňují.
  jiří: "Jiří",
  ivo: "Ivo",
  otto: "Otto",
  hugo: "Hugo",
  bruno: "Bruno",
};

/** Měkké souhlásky — po nich se v 5. pádu přidává „i". */
const MEKKE = ["c", "č", "ď", "j", "ň", "ř", "š", "ť", "ž"];

/** Souhlásky, po kterých se přidává „u". */
const ZADNI = ["k", "g", "h"];

const SAMOHLASKY = ["a", "á", "e", "é", "ě", "i", "í", "o", "ó", "u", "ú", "ů", "y", "ý"];

/**
 * Převede křestní jméno do 5. pádu.
 *
 * Bere jen první slovo — příjmení se v oslovení nepoužívá.
 */
export function patyPad(celeJmeno: string): string {
  const prvni = celeJmeno.trim().split(/\s+/)[0] ?? "";
  if (prvni.length < 2) return prvni;

  const vyjimka = VYJIMKY[prvni.toLowerCase()];
  if (vyjimka) return vyjimka;

  const posledni = prvni.slice(-1).toLowerCase();
  const predposledni = prvni.slice(-2, -1).toLowerCase();
  const konec2 = prvni.slice(-2).toLowerCase();
  const konec3 = prvni.slice(-3).toLowerCase();

  // Marie, Lucie, Julie — zůstávají.
  if (konec2 === "ie") return prvni;

  // Petra → Petro, Honza → Honzo, Mára → Máro, Jana → Jano.
  if (posledni === "a") return `${prvni.slice(0, -1)}o`;

  // Alice, Beatrice, Ivo, Hugo, Jiří, Rudy — beze změny.
  if (SAMOHLASKY.includes(posledni)) return prvni;

  // Daniel → Danieli, Gabriel → Gabrieli.
  if (konec3 === "iel") return `${prvni}i`;

  // Pavel → Pavle, Karel → Karle (obojí je i ve výjimkách, tohle chytí zbytek).
  if (konec2 === "el") return `${prvni.slice(0, -2)}le`;

  // Marek → Marku, Radek → Radku.
  if (konec2 === "ek" && prvni.length > 3) return `${prvni.slice(0, -2)}ku`;

  // Tomáš → Tomáši, Ondřej → Ondřeji, Matěj → Matěji.
  if (MEKKE.includes(posledni)) return `${prvni}i`;

  // Patrik → Patriku, Vojtěch → Vojtěchu, Oleg → Olegu.
  if (ZADNI.includes(posledni)) return `${prvni}u`;

  // Petr → Petře (souhláska před „r"), ale Dalibor → Dalibore (samohláska).
  if (posledni === "r") {
    return SAMOHLASKY.includes(predposledni) ? `${prvni}e` : `${prvni.slice(0, -1)}ře`;
  }

  // Jakub → Jakube, Martin → Martine, David → Davide, Michal → Michale.
  return `${prvni}e`;
}

/**
 * Oslovení uživatele: to, co si nastavil v profilu, jinak návrh
 * z křestního jména (Jakub, 10. 9. 2026). Používají ho e-maily
 * i pozdrav na Dnešku — nikde jinde se oslovení nepočítá znovu.
 */
export function osloveniUzivatele(uzivatel: {
  vocative: string | null;
  firstName: string;
  name: string;
}): string {
  return uzivatel.vocative?.trim() || patyPad(uzivatel.firstName || uzivatel.name);
}

/** Celé oslovení i s pozdravem. */
export function ahoj(celeJmeno: string): string {
  return `Ahoj ${patyPad(celeJmeno)}`;
}
