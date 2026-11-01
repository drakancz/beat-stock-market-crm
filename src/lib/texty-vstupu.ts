import { chybaCesky } from "@/lib/auth-errors";
import type { Jazyk } from "@/lib/jazyk";
import { chybaKlientaCesky } from "@/lib/klient/hlasky";

/**
 * Texty vstupu do aplikace v obou jazycích (Jakub, 23. 10. 2026; viz
 * `jazyk.ts`). Čeština je beze změny proti dřívějším textům v komponentách.
 *
 * **Nový text na přihlašovací stránce, v pruhu nebo průvodci ukázky patří
 * sem v obou jazycích.** Anglicky se vyká neutrálně, česky tým tyká
 * a klientům se vyká jako všude v aplikaci.
 */

type TextyFormulare = {
  email: string;
  heslo: string;
  zapomenute: string;
  prihlasitSe: string;
  overitAPrihlasit: string;
  kodZAplikace: string;
  zalozniKod: string;
  prikladZalozniho: string;
  zpetNaKod: string;
  bezTelefonu: string;
  ukazkaNadpis: string;
  jakoTym: string;
  jakoKlient: string;
};

type TextyStranky = {
  popis: string;
  vychoziEmail: string;
  ukazka: string;
  hesloZmeneno: string;
  kodPotreba: string;
  paticka: string;
};

export type TextyVstupu = {
  prihlaseni: string;
  formular: TextyFormulare;
  tym: TextyStranky & { podtitul: string };
  klient: TextyStranky & { podtitul: string };
  dokumenty: { nazev: string; zasady: string; podminky: string; obchodni: string };
  pruh: string;
  /** Odkaz z přihlašovacích stránek ukázky zpět na Landing Page (krok 1C). */
  zpetNaLandingPage: string;
  pruvodce: {
    nadpis: string;
    tlacitko: string;
    prosli: (hotovo: number, celkem: number) => string;
    poznamka?: string;
    sbalit: string;
    odskrtnout: (nazev: string) => string;
    zrusitOdskrtnuti: (nazev: string) => string;
    zacitZnovu: string;
  };
};

const CHYBY_EN: Record<string, string> = {
  spatne_prihlaseni: "Incorrect email or password.",
  spatny_kod: "Incorrect code. Make sure you are entering the current one.",
  uzamceno: "Too many failed attempts. The account is locked for 15 minutes.",
  prilis_mnoho_pokusu: "Too many failed sign-in attempts. Try again in 5 minutes.",
  CredentialsSignin: "Incorrect email or password.",
  AccessDenied: "You do not have access to this account.",
  SessionRequired: "Your session has expired. Please sign in again.",
  Configuration: "Sign-in is not set up correctly. Please contact the administrator.",
};

export const TEXTY_VSTUPU: Record<Jazyk, TextyVstupu> = {
  cs: {
    prihlaseni: "Přihlášení",
    formular: {
      email: "E-mail",
      heslo: "Heslo",
      zapomenute: "Zapomenuté heslo",
      prihlasitSe: "Přihlásit se",
      overitAPrihlasit: "Ověřit a přihlásit",
      kodZAplikace: "Kód z aplikace",
      zalozniKod: "Záložní kód",
      prikladZalozniho: "např. a1b2c3d4e5",
      zpetNaKod: "Zpět na kód z aplikace",
      bezTelefonu: "Nemám telefon — použít záložní kód",
      ukazkaNadpis: "Ukázka pro zájemce.",
      jakoTym: "Vyzkoušet jako člen týmu",
      jakoKlient: "Vyzkoušet jako klient",
    },
    tym: {
      podtitul: "interní systém",
      popis: "Zadej e-mail a heslo, kterými se do CRM dostáváš.",
      vychoziEmail: "jmeno@beatstockmarket.cz",
      ukazka: "Data jsou vymyšlená a každou noc se obnoví — klidně cokoli změň nebo smaž.",
      hesloZmeneno: "Heslo je změněné a všechna zařízení jsou odhlášená. Přihlas se novým heslem.",
      kodPotreba: "Heslo sedí. Ještě opiš kód z ověřovací aplikace v telefonu.",
      paticka:
        "Přístup jen pro tým Beat Stock Market. Účty zakládá administrátor — veřejná registrace neexistuje.",
    },
    klient: {
      podtitul: "klientská část",
      popis: "Zadejte e-mail, na který vám přišla pozvánka, a své heslo.",
      vychoziEmail: "vas@email.cz",
      ukazka:
        "Takhle vypadá aplikace pro klienty — kurzy, objednávky, členství. Data jsou vymyšlená a každou noc se obnoví.",
      hesloZmeneno:
        "Heslo je změněné a všechna zařízení jsou odhlášená. Přihlaste se novým heslem.",
      kodPotreba: "Heslo sedí. Ještě opište kód z ověřovací aplikace v telefonu.",
      paticka: "Účet do klientské části vám zřídíme po objednávce. Veřejná registrace neexistuje.",
    },
    dokumenty: {
      nazev: "Dokumenty",
      zasady: "Ochrana osobních údajů",
      podminky: "Podmínky",
      obchodni: "Obchodní podmínky",
    },
    pruh: "Ukázka — data jsou vymyšlená a každou noc se vrátí do výchozího stavu. Nic neodchází ven.",
    zpetNaLandingPage: "Zpět na Landing Page",
    pruvodce: {
      nadpis: "Co si tu vyzkoušet",
      tlacitko: "Co si vyzkoušet",
      prosli: (hotovo, celkem) =>
        `Prošli jste ${hotovo} z ${celkem}. Klidně cokoli změňte — v noci se vše vrátí.`,
      sbalit: "Sbalit průvodce",
      odskrtnout: (nazev) => `Odškrtnout: ${nazev}`,
      zrusitOdskrtnuti: (nazev) => `Zrušit odškrtnutí: ${nazev}`,
      zacitZnovu: "Začít znovu",
    },
  },
  en: {
    prihlaseni: "Sign in",
    formular: {
      email: "Email",
      heslo: "Password",
      zapomenute: "Forgot password",
      prihlasitSe: "Sign in",
      overitAPrihlasit: "Verify and sign in",
      kodZAplikace: "Code from the app",
      zalozniKod: "Backup code",
      prikladZalozniho: "e.g. a1b2c3d4e5",
      zpetNaKod: "Back to the app code",
      bezTelefonu: "No phone? Use a backup code",
      ukazkaNadpis: "Demo for prospective clients.",
      jakoTym: "Try as a team member",
      jakoKlient: "Try as a client",
    },
    tym: {
      podtitul: "internal system",
      popis: "Enter the email and password you use for the CRM.",
      vychoziEmail: "name@beatstockmarket.cz",
      ukazka:
        "The data is made up and resets every night, so feel free to change or delete anything. The app itself is in Czech; a guide in English will show you around.",
      hesloZmeneno:
        "Your password has been changed and all devices have been signed out. Sign in with the new password.",
      kodPotreba: "Password accepted. Now enter the code from the authenticator app on your phone.",
      paticka:
        "Access for the Beat Stock Market team only. Accounts are created by an administrator; there is no public sign-up.",
    },
    klient: {
      podtitul: "client area",
      popis: "Enter the email address your invitation was sent to and your password.",
      vychoziEmail: "you@example.com",
      ukazka:
        "This is the app for clients: courses, orders, membership. The data is made up and resets every night. The app itself is in Czech; a guide in English will show you around.",
      hesloZmeneno:
        "Your password has been changed and all devices have been signed out. Sign in with the new password.",
      kodPotreba: "Password accepted. Now enter the code from the authenticator app on your phone.",
      paticka: "We set up your client account after your first order. There is no public sign-up.",
    },
    dokumenty: {
      nazev: "Documents",
      zasady: "Privacy policy (CZ)",
      podminky: "Terms of use (CZ)",
      obchodni: "Terms of sale (CZ)",
    },
    pruh: "Demo: the data is made up and resets to its initial state every night. Nothing is sent out.",
    zpetNaLandingPage: "Back to the landing page",
    pruvodce: {
      nadpis: "What to try here",
      tlacitko: "What to try",
      prosli: (hotovo, celkem) =>
        `You have done ${hotovo} of ${celkem}. Feel free to change anything; it all resets overnight.`,
      poznamka: "The app is in Czech. Each step tells you what to look at.",
      sbalit: "Collapse the guide",
      odskrtnout: (nazev) => `Mark as done: ${nazev}`,
      zrusitOdskrtnuti: (nazev) => `Mark as not done: ${nazev}`,
      zacitZnovu: "Start over",
    },
  },
};

/** Hláška k chybě přihlášení; česky z původních hlášek týmu a klienta. */
export function chybaPrihlaseni(jazyk: Jazyk, druh: "tym" | "klient", kod?: string | null) {
  if (jazyk === "en") return (kod && CHYBY_EN[kod]) || "Something went wrong. Please try again.";
  return druh === "tym" ? chybaCesky(kod) : chybaKlientaCesky(kod);
}
