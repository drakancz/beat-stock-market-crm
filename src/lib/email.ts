import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer, { type Transporter } from "nodemailer";

import { vyresChyby, zapisChybu, type DruhChyby } from "@/lib/chyby";
import {
  obnovaHesla,
  obnovaHeslaKlienta,
  pozvanka,
  pozvankaKlienta,
  upozorneniKlienta,
  upozorneniNaChyby,
  uvitani,
  zkusebni,
  type FirmaVEmailu,
  type PolozkaUpozorneni,
  type Sablona,
} from "@/lib/email-sablony";
import { nactiNastaveni } from "@/lib/nastaveni";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Odesílání e-mailů.
 *
 * Posílají se jen **osobní zprávy systému konkrétnímu člověku** — pozvánka
 * do CRM, odkaz na obnovu hesla a uvítání. Hromadné kampaně zůstávají ve
 * SmartEmailingu (security_warnings.md, pravidlo 8).
 *
 * Systém umí dvě cesty a vybírá si sám podle toho, co je v prostředí:
 *
 * 1. **Amazon SES** (`AWS_SES_ACCESS_KEY_ID` a spol.) — ostrý provoz.
 * 2. **SMTP** (`SMTP_HOST`) — vývoj, kde poštu odchytává Mailpit.
 *
 * Když není vyplněné ani jedno, odesílání se nezapne a volající se to
 * dozví z návratové hodnoty. **Nikdy se nepředstírá, že zpráva odešla.**
 *
 * **Jméno odesílatele, podpis a údaje firmy** jsou z Nastavení (Jakub,
 * 10. 9. 2026). Adresa odesílatele zůstává v `MAIL_FROM` — musí sedět
 * s ověřenou doménou v SES, takže se v rozhraní nemění.
 *
 * **Do logu se nikdy nepíše obsah zprávy, odkaz ani adresa příjemce.**
 * Odkaz na nastavení hesla má stejnou hodnotu jako heslo (pravidlo 3)
 * a adresa je osobní údaj (pravidlo 8).
 */

export type Zpusob = "ses" | "smtp" | "zadny";

interface NastaveniSes {
  zpusob: "ses";
  region: string;
  klic: string;
  tajemstvi: string;
  odesilatel: string;
  /** Sada nastavení v SES, pokud ji účet používá. */
  konfigurace?: string;
}

interface NastaveniSmtp {
  zpusob: "smtp";
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  odesilatel: string;
}

type Nastaveni = NastaveniSes | NastaveniSmtp | null;

function nactiNastaveniPosty(): Nastaveni {
  // Ukázka nepošle ven nic (src/lib/ukazka.ts) — chová se jako server bez
  // pošty, takže rozhraní řekne, že zpráva neodešla, a odkaz vydá rovnou.
  if (jeUkazka()) return null;

  const odesilatel = process.env.MAIL_FROM;
  if (!odesilatel) return null;

  // SES má přednost: když jsou vyplněné klíče, jsme v ostrém provozu.
  const klic = process.env.AWS_SES_ACCESS_KEY_ID;
  const tajemstvi = process.env.AWS_SES_SECRET_ACCESS_KEY;

  if (klic && tajemstvi) {
    return {
      zpusob: "ses",
      // Výchozí region je v Evropské unii — osobní údaje klientů nemají
      // důvod cestovat jinam (pravidlo 8).
      region: process.env.AWS_SES_REGION ?? "eu-central-1",
      klic,
      tajemstvi,
      odesilatel,
      konfigurace: process.env.AWS_SES_CONFIGURATION_SET || undefined,
    };
  }

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT ?? 587);

  return {
    zpusob: "smtp",
    host,
    port: Number.isFinite(port) ? port : 587,
    // Port 465 mluví šifrovaně od prvního bajtu, ostatní se šifrují až
    // příkazem STARTTLS.
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    odesilatel,
  };
}

/** Je odesílání nastavené? Podle toho se rozhodne rozhraní. */
export function odesilaniFunguje(): boolean {
  return nactiNastaveniPosty() !== null;
}

/** Kterou cestou se odesílá. Hodí se do diagnostiky, ne do rozhraní. */
export function zpusobOdesilani(): Zpusob {
  return nactiNastaveniPosty()?.zpusob ?? "zadny";
}

/** Samotná adresa z `MAIL_FROM`, i když je zapsaná jako `Jméno <adresa>`. */
function adresaOdesilatele(mailFrom: string): string {
  const shoda = /<([^>]+)>/.exec(mailFrom);
  return (shoda ? shoda[1] : mailFrom).trim();
}

/* ---------- Odeslání ---------- */

let ses: SESv2Client | undefined;
let prepravka: Transporter | undefined;

async function posliPresSes(
  n: NastaveniSes,
  komu: string,
  sablona: Sablona,
  jmeno: string | null,
): Promise<void> {
  ses ??= new SESv2Client({
    region: n.region,
    credentials: { accessKeyId: n.klic, secretAccessKey: n.tajemstvi },
  });

  // SES chce jméno s diakritikou zakódované podle RFC 2047.
  const od = jmeno
    ? `=?UTF-8?B?${Buffer.from(jmeno, "utf8").toString("base64")}?= <${adresaOdesilatele(n.odesilatel)}>`
    : n.odesilatel;

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: od,
      Destination: { ToAddresses: [komu] },
      ConfigurationSetName: n.konfigurace,
      Content: {
        Simple: {
          Subject: { Data: sablona.predmet, Charset: "UTF-8" },
          Body: {
            Text: { Data: sablona.text, Charset: "UTF-8" },
            Html: { Data: sablona.html, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}

async function posliPresSmtp(
  n: NastaveniSmtp,
  komu: string,
  sablona: Sablona,
  jmeno: string | null,
): Promise<void> {
  prepravka ??= nodemailer.createTransport({
    host: n.host,
    port: n.port,
    secure: n.secure,
    auth: n.user ? { user: n.user, pass: n.password } : undefined,
  });

  await prepravka.sendMail({
    // Nodemailer jméno zakóduje sám.
    from: jmeno ? { name: jmeno, address: adresaOdesilatele(n.odesilatel) } : n.odesilatel,
    to: komu,
    subject: sablona.predmet,
    text: sablona.text,
    html: sablona.html,
  });
}

export type VysledekOdeslani =
  { odeslano: true } | { odeslano: false; duvod: "nenastaveno" | "selhalo" };

/**
 * Čeho se zpráva týká — kvůli sekci Chyby, když odeslání selže (Jakub,
 * 15. 9. 2026). Adresa ani obsah zprávy se u chyby neukládají.
 */
export interface KontextZpravy {
  /** Uživatel CRM, kterému zpráva patří. */
  userId?: string | null;
  /** Klient, kterému zpráva patří (klientská část, 30. 9. 2026). */
  clientId?: string | null;
  /** Kdo odeslání spustil. Prázdné u zapomenutého hesla. */
  spustilId: string | null;
}

async function posli(
  komu: string,
  sablona: Sablona,
  jmeno: string | null,
  druh: DruhChyby,
  kontext: KontextZpravy,
): Promise<VysledekOdeslani> {
  const nastaveni = nactiNastaveniPosty();
  if (!nastaveni) {
    // V ukázce to chyba není, sekce Chyby by se jen plnila.
    if (jeUkazka()) return { odeslano: false, duvod: "nenastaveno" };
    await zapisChybu({
      druh,
      kod: "nenastaveno",
      detail:
        "Na serveru není nastavené odesílání e-mailů (MAIL_FROM a SMTP_HOST, nebo klíče Amazon SES).",
      userId: kontext.userId ?? null,
      clientId: kontext.clientId ?? null,
      spustilId: kontext.spustilId,
    });
    return { odeslano: false, duvod: "nenastaveno" };
  }

  try {
    if (nastaveni.zpusob === "ses") await posliPresSes(nastaveni, komu, sablona, jmeno);
    else await posliPresSmtp(nastaveni, komu, sablona, jmeno);

    // Prošlo — dřívější chyba téže zprávy u téhož člověka je vyřešená.
    await vyresChyby(
      {
        druh,
        ...(kontext.userId ? { userId: kontext.userId } : {}),
        ...(kontext.clientId ? { clientId: kontext.clientId } : {}),
      },
      { zpusob: "vyreseno", kdoId: kontext.spustilId },
    );
    return { odeslano: true };
  } catch (chyba) {
    // Loguje se jen typ chyby, nikdy její obsah — ten by mohl nést adresu
    // příjemce i text zprávy.
    const nazev = chyba instanceof Error ? chyba.name : "neznámá chyba";
    console.error(`Odeslání e-mailu selhalo (${nastaveni.zpusob}, ${nazev}).`);

    // Do sekce Chyby i s textem chyby — e-mailové adresy se z něj před
    // uložením vyhodí (`bezEmailu()`).
    const zprava = chyba instanceof Error && chyba.message ? `: ${chyba.message}` : "";
    await zapisChybu({
      druh,
      kod: "selhalo",
      detail: `${nastaveni.zpusob === "ses" ? "Amazon SES" : "SMTP"} — ${nazev}${zprava}`,
      userId: kontext.userId ?? null,
      clientId: kontext.clientId ?? null,
      spustilId: kontext.spustilId,
    });
    return { odeslano: false, duvod: "selhalo" };
  }
}

/** Údaje z Nastavení, které patří do každé zprávy. */
async function zNastaveni(): Promise<{ firma: FirmaVEmailu; jmeno: string | null }> {
  const nastaveni = await nactiNastaveni();
  return {
    firma: {
      nazev: nastaveni.companyName,
      ico: nastaveni.ico,
      dic: nastaveni.dic,
      adresa: nastaveni.address,
      podpis: nastaveni.emailSignature,
    },
    jmeno: nastaveni.emailSenderName,
  };
}

/* ---------- Jednotlivé zprávy ---------- */

/** Pozvánka novému uživateli. Jako první krok si nastaví heslo. */
export async function posliPozvanku(
  vstup: {
    komu: string;
    /** Oslovení v 5. pádu — `osloveniUzivatele()` ze `src/lib/osloveni.ts`. */
    osloveni: string;
    odkaz: string;
  } & KontextZpravy,
): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    pozvanka({ osloveni: vstup.osloveni, odkaz: vstup.odkaz, firma }),
    jmeno,
    "email.pozvanka",
    vstup,
  );
}

/** Odkaz na obnovu zapomenutého hesla. */
export async function posliObnovuHesla(
  vstup: {
    komu: string;
    /** Oslovení v 5. pádu — `osloveniUzivatele()` ze `src/lib/osloveni.ts`. */
    osloveni: string;
    odkaz: string;
  } & KontextZpravy,
): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    obnovaHesla({ osloveni: vstup.osloveni, odkaz: vstup.odkaz, firma }),
    jmeno,
    "email.obnova-hesla",
    vstup,
  );
}

/** Uvítání po prvním nastavení hesla. */
export async function posliUvitani(
  vstup: {
    komu: string;
    /** Oslovení v 5. pádu — `osloveniUzivatele()` ze `src/lib/osloveni.ts`. */
    osloveni: string;
  } & KontextZpravy,
): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    uvitani({ osloveni: vstup.osloveni, firma }),
    jmeno,
    "email.uvitani",
    vstup,
  );
}

/** Zkušební zpráva z Nastavení → Firma a e-maily. */
export async function posliZkusebniEmail(
  vstup: {
    komu: string;
    /** Oslovení v 5. pádu — `osloveniUzivatele()` ze `src/lib/osloveni.ts`. */
    osloveni: string;
  } & KontextZpravy,
): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    zkusebni({ osloveni: vstup.osloveni, firma }),
    jmeno,
    "email.zkusebni",
    vstup,
  );
}

/**
 * Upozornění administrátorovi na nové chyby (Jakub, 15. 9. 2026). Kdy
 * a komu, rozhoduje `src/lib/upozorneni-chyb.ts`. Když neodejde, zapíše se
 * do sekce Chyby — jako chyba e-mailu další upozornění nespustí.
 */
export async function posliUpozorneniNaChyby(
  vstup: {
    komu: string;
    /** Oslovení v 5. pádu — `osloveniUzivatele()` ze `src/lib/osloveni.ts`. */
    osloveni: string;
    polozky: PolozkaUpozorneni[];
    celkem: number;
    nevyresenych: number;
    od: string;
  } & KontextZpravy,
): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    upozorneniNaChyby({
      osloveni: vstup.osloveni,
      polozky: vstup.polozky,
      celkem: vstup.celkem,
      nevyresenych: vstup.nevyresenych,
      od: vstup.od,
      firma,
    }),
    jmeno,
    "email.upozorneni",
    vstup,
  );
}

/* ---------- Zprávy pro klienty (klientská část, 30. 9. 2026) ---------- */

/** Pozvánka klienta do klientské části. Chyba se eviduje u karty klienta. */
export async function posliPozvankuKlientovi(vstup: {
  komu: string;
  odkaz: string;
  clientId: string;
  spustilId: string | null;
}): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    pozvankaKlienta({ odkaz: vstup.odkaz, firma }),
    jmeno,
    "email.pozvanka-klienta",
    { clientId: vstup.clientId, spustilId: vstup.spustilId },
  );
}

/** Odkaz na nové heslo do klientské části (zapomenuté heslo). */
export async function posliObnovuHeslaKlientovi(vstup: {
  komu: string;
  odkaz: string;
  clientId: string;
}): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  return posli(
    vstup.komu,
    obnovaHeslaKlienta({ odkaz: vstup.odkaz, firma }),
    jmeno,
    "email.obnova-klienta",
    { clientId: vstup.clientId, spustilId: null },
  );
}

/**
 * Upozornění klientovi e-mailem místo oznámení v telefonu (3A, 4. 10. 2026).
 * Volá ho jen `upozorniKlienta()` ze `src/lib/klient/oznameni.ts`.
 */
export async function posliUpozorneniKlientovi(vstup: {
  komu: string;
  clientId: string;
  predmet: string;
  odstavce: string[];
  /** Stránka klientské části, kam má tlačítko vést (`/ucet/…`). */
  odkaz: string;
}): Promise<VysledekOdeslani> {
  const { firma, jmeno } = await zNastaveni();
  const zaklad = process.env.AUTH_URL ?? "http://localhost:3000";
  return posli(
    vstup.komu,
    upozorneniKlienta({
      predmet: vstup.predmet,
      odstavce: vstup.odstavce,
      odkaz: `${zaklad}${vstup.odkaz}`,
      firma,
    }),
    jmeno,
    "email.upozorneni-klienta",
    { clientId: vstup.clientId, spustilId: null },
  );
}
