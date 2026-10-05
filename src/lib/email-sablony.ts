/**
 * Šablony e-mailů.
 *
 * E-mailové rozhraní se píše jinak než web: rozvržení stojí na tabulkách,
 * styly musí být vepsané přímo u prvků a moderní vlastnosti (flex, grid,
 * proměnné) většina poštovních klientů ignoruje. Proto tenhle soubor
 * vypadá staromódně — je to záměr, ne nedbalost.
 *
 * Každá zpráva má **dvě podoby**: HTML a prostý text. Text není náhradní
 * plán, ale plnohodnotná verze pro toho, kdo si HTML nezobrazuje —
 * a taky to, co zabrání tomu, aby zprávu filtry označily za spam.
 *
 * Obrázky jsou PNG, ne SVG: SVG v e-mailu nevykreslí ani Gmail, ani
 * Outlook. Často se navíc nenačtou vůbec, takže zpráva musí dávat smysl
 * i bez nich — proto má karta vlastní tmavé pozadí a název značky je
 * napsaný textem.
 *
 * Podpis a údaje firmy v patičce nastavuje administrátor v Nastavení →
 * Firma a e-maily (Jakub, 10. 9. 2026). Jsou to texty od uživatele, takže
 * jdou do HTML jen přes `bezpecne()`.
 *
 * Oslovení je v 5. pádu („Ahoj Jakube"). Skloňování řeší
 * `src/lib/osloveni.ts`.
 */

import { pocet } from "@/lib/mnozne";

export interface Sablona {
  predmet: string;
  text: string;
  html: string;
}

/** Co z Nastavení patří do každé zprávy. */
export interface FirmaVEmailu {
  nazev: string;
  ico: string | null;
  dic: string | null;
  adresa: string | null;
  /** Podpis pod zprávou, prostý text s řádky. */
  podpis: string | null;
}

const ZNACKA = "Beat Stock Market";

/* ---------- Barvy ---------- */

const BARVY = {
  pozadi: "#070c14",
  karta: "#0e1826",
  ramecek: "#1d2f47",
  linka: "#1b2a3e",
  nadpis: "#f2f7fc",
  text: "#adbdd1",
  tichy: "#7b8da5",
  neon: "#38bdf8",
  neonSvetly: "#67e8f9",
  tlacitko: "#38bdf8",
  tlacitkoText: "#06121f",
} as const;

function zakladniAdresa(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/** Nahradí znaky, které by v HTML rozbily strukturu. */
function bezpecne(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Údaje firmy do patičky: `Firma s.r.o. · IČO 12345678 · Ulice 1, Praha`. */
function radekFirmy(firma: FirmaVEmailu): string {
  return [
    firma.nazev,
    firma.ico ? `IČO ${firma.ico}` : null,
    firma.dic ? `DIČ ${firma.dic}` : null,
    firma.adresa,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface Obsah {
  /** Krátký text, který se ukáže v seznamu zpráv vedle předmětu. */
  nahled: string;
  nadpis: string;
  /** Odstavce těla. Prosté věty, bez HTML. */
  odstavce: string[];
  tlacitko: { popisek: string; odkaz: string };
  /** Vysvětlení pod tlačítkem — platnost odkazu a podobně. */
  poznamka?: string;
  /** Poslední věta, obvykle „když jsi o nic nežádal…". */
  patka?: string;
  /**
   * Zpráva pro klienta (klientská část, 30. 9. 2026) — patička pak
   * nepíše „Interní systém" a vyká.
   */
  proKlienta?: boolean;
}

/** Věta o tom, odkud zpráva je. Tým tyká, klientům se vyká. */
function patickaSystemu(obsah: Obsah): string {
  return obsah.proKlienta
    ? `Klientská část ${ZNACKA}. Tuto zprávu posílá systém automaticky — neodpovídejte na ni.`
    : `Interní systém ${ZNACKA}. Tuto zprávu posílá systém automaticky — neodpovídej na ni.`;
}

/* ---------- Společné rozvržení ---------- */

function rozvrzeni(obsah: Obsah, firma: FirmaVEmailu): string {
  const zaklad = zakladniAdresa();
  const odkaz = bezpecne(obsah.tlacitko.odkaz);

  const odstavce = obsah.odstavce
    .map(
      (o) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BARVY.text};">${bezpecne(o)}</p>`,
    )
    .join("");

  const podpis = firma.podpis
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${BARVY.text};">${bezpecne(firma.podpis).replace(/\r?\n/g, "<br>")}</p>`
    : "";

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${bezpecne(obsah.nadpis)}</title>
</head>
<body style="margin:0;padding:0;background:${BARVY.pozadi};">

<!-- Náhled v seznamu zpráv. Skrytý, ale klienti ho čtou. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${bezpecne(obsah.nahled)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BARVY.pozadi};">
  <tr>
    <td align="center" style="padding:32px 16px 40px;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">

        <!-- Hlavička se značkou -->
        <tr>
          <td align="center" style="padding:0 0 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:10px;" valign="middle">
                  <img src="${zaklad}/znacka-email.png" width="40" height="21" alt=""
                       style="display:block;border:0;width:40px;height:21px;">
                </td>
                <td valign="middle">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1.6px;color:${BARVY.nadpis};text-transform:uppercase;">${ZNACKA}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Karta se zprávou -->
        <tr>
          <td style="background:${BARVY.karta};border:1px solid ${BARVY.ramecek};border-radius:12px;font-family:Arial,Helvetica,sans-serif;">

            <!-- Záhlaví: svíčkový graf -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="line-height:0;font-size:0;">
                  <img src="${zaklad}/zahlavi-email.png" width="560" alt=""
                       style="display:block;border:0;width:100%;max-width:560px;height:auto;border-radius:11px 11px 0 0;">
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:30px 32px 28px;">

                  <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:bold;color:${BARVY.nadpis};">${bezpecne(obsah.nadpis)}</h1>

                  ${odstavce}

                  <!-- Tlačítko. Postavené na tabulce, aby ho vykreslil i Outlook. -->
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 18px;">
                    <tr>
                      <td align="center" bgcolor="${BARVY.tlacitko}" style="border-radius:8px;">
                        <a href="${odkaz}"
                           style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${BARVY.tlacitkoText};text-decoration:none;border-radius:8px;">${bezpecne(obsah.tlacitko.popisek)}</a>
                      </td>
                    </tr>
                  </table>

                  ${
                    obsah.poznamka
                      ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:${BARVY.tichy};">${bezpecne(obsah.poznamka)}</p>`
                      : ""
                  }

                  <!-- Podpis z Nastavení -->
                  ${podpis}

                  <!-- Odkaz i v textové podobě: tlačítka někdy nejdou kliknout. -->
                  <p style="margin:0 0 6px;font-size:12px;color:${BARVY.tichy};">Kdyby tlačítko nefungovalo, otevři tuto adresu:</p>
                  <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
                    <a href="${odkaz}" style="color:${BARVY.neonSvetly};text-decoration:underline;">${odkaz}</a>
                  </p>

                  ${
                    obsah.patka
                      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                           <tr><td style="border-top:1px solid ${BARVY.linka};padding-top:16px;">
                             <p style="margin:0;font-size:13px;line-height:1.6;color:${BARVY.tichy};">${bezpecne(obsah.patka)}</p>
                           </td></tr>
                         </table>`
                      : ""
                  }

                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Patička -->
        <tr>
          <td align="center" style="padding:18px 8px 0;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:${BARVY.tichy};">
              ${bezpecne(patickaSystemu(obsah))}
            </p>
            <p style="margin:4px 0 0;font-size:11px;line-height:1.6;color:${BARVY.tichy};">${bezpecne(radekFirmy(firma))}</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

/** Textová podoba téže zprávy. */
function prostyText(obsah: Obsah, firma: FirmaVEmailu): string {
  return [
    obsah.nadpis,
    "",
    ...obsah.odstavce.flatMap((o) => [o, ""]),
    `${obsah.tlacitko.popisek}:`,
    obsah.tlacitko.odkaz,
    ...(obsah.poznamka ? ["", obsah.poznamka] : []),
    ...(firma.podpis ? ["", firma.podpis] : []),
    ...(obsah.patka ? ["", obsah.patka] : []),
    "",
    "—",
    patickaSystemu(obsah),
    radekFirmy(firma),
  ].join("\n");
}

function sestav(predmet: string, obsah: Obsah, firma: FirmaVEmailu): Sablona {
  return { predmet, text: prostyText(obsah, firma), html: rozvrzeni(obsah, firma) };
}

/* ---------- Jednotlivé zprávy ---------- */

/**
 * Pozvánka do systému.
 *
 * Zároveň slouží jako ověření e-mailu: kdo si otevře odkaz a nastaví
 * heslo, prokázal tím, že do té schránky má přístup. Samostatný krok
 * „ověřte svou adresu" proto systém nemá.
 */
export function pozvanka(vstup: { osloveni: string; odkaz: string; firma: FirmaVEmailu }): Sablona {
  const { osloveni } = vstup;

  return sestav(
    `Vítej v CRM ${ZNACKA}`,
    {
      nahled: "Máš tu připravený účet. Zbývá nastavit heslo — zabere to minutu.",
      nadpis: "Vítej v týmu",
      odstavce: [
        `Ahoj ${osloveni}, máš připravený účet do interního systému ${ZNACKA}. Je to místo, kde spolu vedeme klienty: hovory, úkoly, portfolia u brokerů i to, kdo co koupil.`,
        "Zbývá jediný krok — nastavit si heslo. Zvolíš si ho jen ty a nikdo jiný v systému ho neuvidí, ani administrátor. Jakmile ho zadáš, rovnou tě to přihlásí a jsi uvnitř.",
      ],
      tlacitko: { popisek: "Nastavit heslo a vstoupit", odkaz: vstup.odkaz },
      poznamka: "Odkaz platí jednu hodinu a dá se použít jen jednou.",
      patka:
        "Pokud odkaz mezitím vyprší, řekni si administrátorovi o nový. Tahle zpráva ti přišla, protože tě někdo z týmu pozval do systému.",
    },
    vstup.firma,
  );
}

/** Obnova zapomenutého hesla. */
export function obnovaHesla(vstup: {
  osloveni: string;
  odkaz: string;
  firma: FirmaVEmailu;
}): Sablona {
  const { osloveni } = vstup;

  return sestav(
    `Nastavení nového hesla do CRM ${ZNACKA}`,
    {
      nahled: "Odkaz na nové heslo. Platí hodinu a použije se jednou.",
      nadpis: "Nastavení nového hesla",
      odstavce: [
        `Ahoj ${osloveni}, někdo požádal o nové heslo k tvému účtu.`,
        "Nové heslo si nastavíš tlačítkem níž. Dosavadní heslo platí až do chvíle, kdy zadáš nové.",
      ],
      tlacitko: { popisek: "Nastavit nové heslo", odkaz: vstup.odkaz },
      poznamka: "Odkaz platí jednu hodinu a dá se použít jen jednou.",
      patka:
        "Pokud jsi o nové heslo nežádal, tuhle zprávu ignoruj — nic se nezměnilo a tvoje heslo zůstává v platnosti.",
    },
    vstup.firma,
  );
}

/** Uvítání po prvním nastavení hesla. */
export function uvitani(vstup: { osloveni: string; firma: FirmaVEmailu }): Sablona {
  const { osloveni } = vstup;

  return sestav(
    `Účet v CRM ${ZNACKA} je připravený`,
    {
      nahled: "Heslo je nastavené. Tady je, čím začít.",
      nadpis: "Hotovo, jsi uvnitř",
      odstavce: [
        `Ahoj ${osloveni}, heslo je nastavené a účet připravený k práci.`,
        "Jako první krok si v Mém účtu zapni dvoufázové ověření. Systém drží data klientů, takže samotné heslo je málo — druhý krok přes aplikaci v telefonu zabere minutu.",
        "Co v systému najdeš: Dnešek s úkoly a hovory na dnešní den, karty klientů s celou historií, portfolia u jednotlivých brokerů a přehled produktů.",
      ],
      tlacitko: { popisek: "Přejít do CRM", odkaz: zakladniAdresa() },
      patka: "Kdyby cokoli nefungovalo, ozvi se administrátorovi systému.",
    },
    vstup.firma,
  );
}

/** Jedna řádka souhrnu chyb — bez osobních údajů. */
export interface PolozkaUpozorneni {
  /** Druh chyby, třeba „SmartEmailing — odeslání klienta". */
  druh: string;
  pocet: number;
  /** Krátký důvod poslední chyby toho druhu, třeba „SmartEmailing kontakt nepřijal". */
  duvod: string;
}

/**
 * Upozornění administrátorovi na nové chyby (Jakub, 15. 9. 2026).
 *
 * **Bez osobních údajů** — jen druh, počet a důvod. Jméno ani e-mail
 * klienta do zprávy nepatří: jde přes cizí službu a zůstává ve schránce
 * (security_warnings.md, pravidlo 8). Koho se chyba týká, je v sekci Chyby.
 */
export function upozorneniNaChyby(vstup: {
  osloveni: string;
  polozky: PolozkaUpozorneni[];
  /** Kolik chyb přibylo od posledního upozornění. */
  celkem: number;
  /** Kolik je teď nevyřešených celkem. */
  nevyresenych: number;
  /** Kdy přibyla první z nich, už naformátované. */
  od: string;
  firma: FirmaVEmailu;
}): Sablona {
  const { osloveni, polozky, celkem } = vstup;
  const pocetChyb = pocet(celkem, "nová chyba", "nové chyby", "nových chyb");
  // Sloveso se řídí počtem: přibyla 1 chyba, přibyly 3 chyby, přibylo 5 chyb.
  const pribylo = celkem === 1 ? "přibyla" : celkem >= 2 && celkem <= 4 ? "přibyly" : "přibylo";

  return sestav(
    `CRM ${ZNACKA}: ${pocetChyb}`,
    {
      nahled: polozky.map((polozka) => `${polozka.druh}: ${polozka.pocet}×`).join(", "),
      nadpis: "V CRM se něco pokazilo",
      odstavce: [
        `Ahoj ${osloveni}, od ${vstup.od} v CRM ${pribylo} ${pocetChyb}. Nevyřešených je teď celkem ${vstup.nevyresenych}.`,
        ...polozky.map((polozka) => `• ${polozka.druh} — ${polozka.pocet}× (${polozka.duvod})`),
        "Koho se chyby týkají, je vidět jen v CRM — osobní údaje do e-mailu nepatří. Tam jde chybu znovu spustit, nebo uzavřít.",
      ],
      tlacitko: { popisek: "Otevřít Chyby", odkaz: `${zakladniAdresa()}/smartemailing/chyby` },
      poznamka:
        "Upozornění chodí nejvýš jednou za 15 minut. Chyby, které mezitím přibudou, přijdou v dalším e-mailu.",
      patka: "Upozornění dostávají všichni administrátoři. Vypnout jde v Nastavení → Upozornění.",
    },
    vstup.firma,
  );
}

/** Zkušební zpráva z Nastavení — ukáže jméno odesílatele, podpis i patičku. */
export function zkusebni(vstup: { osloveni: string; firma: FirmaVEmailu }): Sablona {
  const { osloveni } = vstup;

  return sestav(
    `Zkušební e-mail z CRM ${ZNACKA}`,
    {
      nahled: "Takhle vypadají e-maily, které posílá systém.",
      nadpis: "Zkušební e-mail",
      odstavce: [
        `Ahoj ${osloveni}, tohle je zkušební zpráva z Nastavení. Takhle uvidí e-maily ze systému kolegové — se jménem odesílatele, podpisem i údaji firmy v patičce.`,
      ],
      tlacitko: {
        popisek: "Otevřít Nastavení",
        odkaz: `${zakladniAdresa()}/nastaveni/firma`,
      },
      patka: "Tahle zpráva přišla z tlačítka v Nastavení → Firma a e-maily.",
    },
    vstup.firma,
  );
}

/* ---------- Zprávy pro klienty (krok 3A, 30. 9. 2026) ---------- */

/*
 * Klientům se **vyká** a oslovení je obecné „Dobrý den" — jméno klienta
 * zadal on sám nebo tým a 5. pád z něj nemusí vyjít hezky. Tým si dál tyká.
 */

/** Pozvánka klienta do klientské části. Zároveň ověřuje e-mail. */
export function pozvankaKlienta(vstup: { odkaz: string; firma: FirmaVEmailu }): Sablona {
  return sestav(
    `Váš účet v klientské části ${ZNACKA}`,
    {
      nahled: "Máte připravený účet. Zbývá nastavit heslo — zabere to minutu.",
      nadpis: "Vítejte v klientské části",
      odstavce: [
        `Dobrý den, připravili jsme vám účet v klientské části ${ZNACKA}. Uvidíte v ní svoje objednávky, do kdy vám platí členství a svoje údaje.`,
        "Zbývá jediný krok — nastavit si heslo. Zvolíte si ho jen vy a nikdo jiný ho neuvidí, ani my.",
      ],
      tlacitko: { popisek: "Nastavit heslo", odkaz: vstup.odkaz },
      poznamka: "Odkaz platí jednu hodinu a dá se použít jen jednou.",
      patka:
        "Pokud odkaz mezitím vyprší, napište nám a pošleme nový. Pokud jste u nás nic neobjednávali, tuto zprávu prosím ignorujte.",
      proKlienta: true,
    },
    vstup.firma,
  );
}

/** Obnova zapomenutého hesla do klientské části. */
export function obnovaHeslaKlienta(vstup: { odkaz: string; firma: FirmaVEmailu }): Sablona {
  return sestav(
    `Nové heslo do klientské části ${ZNACKA}`,
    {
      nahled: "Odkaz na nové heslo. Platí hodinu a použije se jednou.",
      nadpis: "Nastavení nového hesla",
      odstavce: [
        "Dobrý den, někdo požádal o nové heslo k vašemu účtu v klientské části.",
        "Nové heslo si nastavíte tlačítkem níž. Dosavadní heslo platí až do chvíle, kdy zadáte nové.",
      ],
      tlacitko: { popisek: "Nastavit nové heslo", odkaz: vstup.odkaz },
      poznamka: "Odkaz platí jednu hodinu a dá se použít jen jednou.",
      patka:
        "Pokud jste o nové heslo nežádali, tuto zprávu ignorujte — nic se nezměnilo a vaše heslo zůstává v platnosti.",
      proKlienta: true,
    },
    vstup.firma,
  );
}

/**
 * Upozornění klientovi místo oznámení v telefonu (krok 3A, 4. 10. 2026) —
 * když klient nemá oznámení povolená na žádném zařízení. Zaplacená
 * objednávka, povolený přístup, konec členství i zpráva od administrátora.
 */
export function upozorneniKlienta(vstup: {
  predmet: string;
  odstavce: string[];
  odkaz: string;
  firma: FirmaVEmailu;
}): Sablona {
  return sestav(
    vstup.predmet,
    {
      nahled: vstup.odstavce[0] ?? vstup.predmet,
      nadpis: vstup.predmet,
      odstavce: vstup.odstavce,
      tlacitko: { popisek: "Otevřít klientskou část", odkaz: vstup.odkaz },
      patka:
        "Tato upozornění si můžete vypnout v klientské části v Mém profilu. Když si tam povolíte oznámení v telefonu, budou chodit tam místo e-mailu.",
      proKlienta: true,
    },
    vstup.firma,
  );
}
