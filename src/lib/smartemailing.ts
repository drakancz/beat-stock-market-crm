import { z } from "zod";

import { zapisDoAuditu } from "@/lib/audit";
import { vyresChyby, zapisChybu } from "@/lib/chyby";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import { jeUkazka, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";
import { tajemstviZProstredi } from "@/lib/verejne-api";

/**
 * Propojení se SmartEmailingem (Jakub, 13. 9. 2026).
 *
 * Nový klient **se souhlasem s marketingem** se zapíše do seznamu
 * odběratelů, který administrátor vybral v sekci SmartEmailing →
 * Nastavení propojení. Platí to pro klienta založeného ve formuláři
 * i přijatého z webu přes `POST /api/leady` (Jakub, 15. 9. 2026).
 *
 * **Úprava klienta se propisuje** (Jakub, 15. 9. 2026, přepsáno proti
 * 13. 9.): zaškrtnutý souhlas klienta přihlásí, odebraný souhlas ho ze
 * seznamu odhlásí a nový e-mail se přihlásí místo starého, který se odhlásí
 * (`propisUpravuKlienta()`). Rozhoduje souhlas v CRM — po úpravě se přihlásí
 * i ten, kdo se ve SmartEmailingu dřív odhlásil. Automatické odeslání
 * nového klienta a hromadné odeslání odhlášené dál nechávají odhlášené.
 *
 * Když odeslání selže, chyba se zapíše ke klientovi i s popisem, co
 * SmartEmailing odpověděl. Kdo klienta založil, uvidí na jeho kartě
 * červený pruh (Jakub, 15. 9. 2026) — karta se po založení sama obnovuje,
 * dokud výsledek nepřijde (`cekaNaOdeslani()`). Administrátor chybu uvidí
 * i v sekci Chyby (`src/lib/chyby.ts`) a spustí ji znovu. Hromadné odeslání
 * stávajících klientů a načtení odhlášených je v `smartemailing-synchronizace.ts`.
 *
 * Pravidla, která tu platí:
 *
 * 1. **Bez souhlasu neodejde nic** (security_warnings.md, pravidla 6 a 8).
 *    Kontroluje se tady, těsně před odesláním, ne ve formuláři — i při
 *    opakování, kdy mohl souhlas mezitím zmizet.
 * 2. **Odchází jen e-mail, jméno a příjmení.** Telefon ani poznámku
 *    kampaně nepotřebují. Při opakování se posílají aktuální údaje
 *    z karty klienta, původní požadavek se nikde neukládá.
 * 3. **Přihlašovací údaje jsou jen v `.env`** (pravidlo 3) a v rozhraní
 *    se nikde nezobrazují.
 * 4. **Do logu nejde adresa ani text odpovědi SmartEmailingu** — jen druh
 *    chyby. Text odpovědi se ukládá ke klientovi pro administrátora, ale
 *    **s nahrazenými e-mailovými adresami** (pravidlo 8).
 * 5. **Výpadek SmartEmailingu nesmí shodit založení klienta.** Odesílá se
 *    až po odpovědi (`after()`) a výsledek se zapíše ke klientovi.
 *
 * Rozhraní: https://app.smartemailing.cz/docs/api/v3/index.html (verze
 * popisu 3.1.26). Limit je 4 volání za sekundu na účet.
 */

const ADRESA_API = "https://app.smartemailing.cz/api/v3";

/** Déle se na odpověď nečeká. Běží to po odeslání stránky, ale ne donekonečna. */
const LIMIT_CEKANI_MS = 10_000;

export type ChybaSmartemailingu =
  "nenastaveno" | "prihlaseni" | "licence" | "odmitnuto" | "limit" | "nedostupne";

export const POPIS_CHYBY_SMARTEMAILINGU: Record<ChybaSmartemailingu, string> = {
  nenastaveno: "Propojení není na serveru nastavené",
  prihlaseni: "SmartEmailing odmítl přihlašovací údaje",
  // 402 — účet nemá zaplacený tarif (zjištěno 28. 9. 2026). Přihlašovací
  // údaje jsou v pořádku, pomůže jen zaplatit licenci ve SmartEmailingu.
  licence: "Účet SmartEmailingu nemá platnou licenci (předplatné)",
  odmitnuto: "SmartEmailing kontakt nepřijal",
  limit: "SmartEmailing hlásí příliš mnoho volání",
  nedostupne: "SmartEmailing neodpověděl",
};

/** Jak dlouho po založení karta klienta čeká na výsledek odeslání. */
const CEKANI_NA_VYSLEDEK_MS = 30_000;

/**
 * Běží ještě odeslání právě založeného klienta?
 *
 * Odesílá se až po uložení (`after()`), takže když se karta nového klienta
 * poprvé vykreslí, výsledek ještě není. Karta se podle téhle funkce pár
 * sekund sama obnovuje, aby varování o selhání uviděl i ten, kdo klienta
 * založil (Jakub, 15. 9. 2026). Pokus se zapisuje při úspěchu i chybě.
 */
export function cekaNaOdeslani(
  klient: { createdAt: Date; consentMarketingAt: Date | null; smartemailingAttemptAt: Date | null },
  nastaveni: { smartemailingEnabled: boolean; smartemailingListId: number | null },
): boolean {
  return (
    nastaveni.smartemailingEnabled &&
    nastaveni.smartemailingListId !== null &&
    klient.consentMarketingAt !== null &&
    klient.smartemailingAttemptAt === null &&
    Date.now() - klient.createdAt.getTime() < CEKANI_NA_VYSLEDEK_MS
  );
}

type Vysledek<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      chyba: ChybaSmartemailingu;
      /** Co přesně se stalo — pro administrátora, bez e-mailových adres. */
      detail: string;
    };

/** Nejdelší popis chyby, který se u klienta uloží (sloupec má 500 znaků). */
const MAX_DETAIL = 500;

/**
 * Popis chyby pro administrátora: kód odpovědi a text, který SmartEmailing
 * vrátil. **E-mailové adresy se nahradí** — text odpovědi může obsahovat
 * adresu klienta a do chybových hlášení osobní údaje nepatří (pravidlo 8).
 * HTML značky (chybová stránka místo JSON) se vyhodí.
 */
function popisChyby(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g, "[e-mail]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DETAIL);
}

/** Jsou v prostředí vyplněné přihlašovací údaje? Samotné hodnoty se nevrací. */
export function smartemailingNastaveny(): boolean {
  return Boolean(process.env.SMARTEMAILING_USERNAME && process.env.SMARTEMAILING_API_KEY);
}

function druhChyby(status: number): ChybaSmartemailingu {
  if (status === 401 || status === 403) return "prihlaseni";
  if (status === 402) return "licence";
  if (status === 429) return "limit";
  if (status >= 500) return "nedostupne";
  return "odmitnuto";
}

async function zavolej(
  cesta: string,
  pozadavek: { method: "GET" | "DELETE" } | { method: "POST"; body: unknown } = { method: "GET" },
): Promise<Vysledek<unknown>> {
  // Ukázka nepošle ven nic (src/lib/ukazka.ts) — obrazovky zůstanou, volání ne.
  if (jeUkazka()) return { ok: false, chyba: "nenastaveno", detail: VYPNUTO_V_UKAZCE };

  const jmeno = process.env.SMARTEMAILING_USERNAME;
  const klic = process.env.SMARTEMAILING_API_KEY;
  if (!jmeno || !klic) {
    return {
      ok: false,
      chyba: "nenastaveno",
      detail: "V .env chybí SMARTEMAILING_USERNAME nebo SMARTEMAILING_API_KEY.",
    };
  }

  let odpoved: Response;
  try {
    odpoved = await fetch(`${ADRESA_API}${cesta}`, {
      method: pozadavek.method,
      headers: {
        // Přihlašovací jméno je e-mail do SmartEmailingu, heslo API klíč.
        Authorization: `Basic ${Buffer.from(`${jmeno}:${klic}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: pozadavek.method === "POST" ? JSON.stringify(pozadavek.body) : undefined,
      signal: AbortSignal.timeout(LIMIT_CEKANI_MS),
    });
  } catch (chyba) {
    const vyprselo =
      chyba instanceof Error && (chyba.name === "TimeoutError" || chyba.name === "AbortError");
    return {
      ok: false,
      chyba: "nedostupne",
      detail: vyprselo
        ? `SmartEmailing neodpověděl do ${LIMIT_CEKANI_MS / 1000} sekund.`
        : "Spojení se SmartEmailingem se nepodařilo navázat.",
    };
  }

  if (!odpoved.ok) {
    let text = "";
    try {
      text = await odpoved.text();
    } catch {
      // Tělo odpovědi se nepodařilo přečíst — stačí kód.
    }

    // SmartEmailing posílá { status: "error", message: "…" }; když ne, bere se celý text.
    let zprava = text;
    try {
      const json: unknown = JSON.parse(text);
      if (
        json &&
        typeof json === "object" &&
        typeof (json as { message?: unknown }).message === "string"
      ) {
        zprava = (json as { message: string }).message;
      }
    } catch {
      // Nebyl to JSON — zůstává původní text.
    }

    return {
      ok: false,
      chyba: druhChyby(odpoved.status),
      detail: popisChyby(`HTTP ${odpoved.status}${zprava ? `: ${zprava}` : ""}`),
    };
  }

  try {
    // Smazání odpovídá 204 bez těla — to je v pořádku, jen není co číst.
    const text = await odpoved.text();
    return { ok: true, data: text.trim() === "" ? null : JSON.parse(text) };
  } catch {
    return {
      ok: false,
      chyba: "nedostupne",
      detail: `HTTP ${odpoved.status}: SmartEmailing vrátil odpověď, které CRM nerozumí.`,
    };
  }
}

/* ---------- Nastavení ---------- */

/** Zkouška spojení — jestli SmartEmailing přijme přihlašovací údaje z `.env`. */
export async function overSpojeniSmartemailingu(): Promise<Vysledek<null>> {
  const vysledek = await zavolej("/check-credentials");
  return vysledek.ok ? { ok: true, data: null } : vysledek;
}

export interface SeznamOdberatelu {
  id: number;
  name: string;
}

const seznamySchema = z.object({
  data: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
});

/** Seznamy odběratelů v účtu, seřazené podle názvu. */
export async function nactiSeznamyOdberatelu(): Promise<Vysledek<SeznamOdberatelu[]>> {
  const vysledek = await zavolej("/contactlists?select=id,name&sort=name&limit=500");
  if (!vysledek.ok) return vysledek;

  const seznamy = seznamySchema.safeParse(vysledek.data);
  if (!seznamy.success) {
    return {
      ok: false,
      chyba: "nedostupne",
      detail: "Seznamy přišly v podobě, které CRM nerozumí.",
    };
  }

  return { ok: true, data: seznamy.data.data };
}

/* ---------- Webhook: příjem odhlášených ---------- */

/**
 * Přihlašovací jméno, které SmartEmailing posílá s každou zprávou webhooku
 * (Jakub, 15. 9. 2026). Heslo k němu je jen v `.env`
 * (`SMARTEMAILING_WEBHOOK_SECRET`) — SmartEmailing zprávy nepodepisuje,
 * takže jméno a heslo je jediné, čím se prokáže.
 */
export const JMENO_WEBHOOKU = "crm-beatstockmarket";

/** Kratší heslo by šlo uhodnout zkoušením. */

/** Heslo webhooku z `.env`, nebo `null`, když chybí nebo je moc krátké. */
export function hesloWebhooku(): string | null {
  return tajemstviZProstredi("SMARTEMAILING_WEBHOOK_SECRET");
}

const CESTA_WEBHOOKU = "/api/smartemailing/odhlaseni";

export type AdresaWebhooku =
  { ok: true; adresa: string } | { ok: false; adresa: string; duvod: string };

/**
 * Adresa v CRM, kterou SmartEmailing volá — skládá se z `AUTH_URL`.
 *
 * Musí být **veřejná a přes https**: na localhost ani do vnitřní sítě se
 * SmartEmailing nedostane, a přes http by heslo webhooku šlo sítí čitelně.
 */
export function adresaWebhooku(): AdresaWebhooku {
  const zaklad = process.env.AUTH_URL ?? "http://localhost:3000";

  let url: URL;
  try {
    url = new URL(CESTA_WEBHOOKU, zaklad);
  } catch {
    return { ok: false, adresa: zaklad, duvod: "AUTH_URL v .env není platná adresa." };
  }

  const adresa = url.toString();
  const hostitel = url.hostname;
  const neverejny =
    hostitel === "localhost" ||
    hostitel.endsWith(".localhost") ||
    hostitel.endsWith(".local") ||
    hostitel === "[::1]" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostitel);

  if (neverejny) {
    return {
      ok: false,
      adresa,
      duvod: "Aplikace neběží na veřejné adrese, SmartEmailing se k ní z internetu nedostane.",
    };
  }
  if (url.protocol !== "https:") {
    return { ok: false, adresa, duvod: "Adresa aplikace (AUTH_URL) není přes https." };
  }
  return { ok: true, adresa };
}

const webhookySchema = z.object({
  data: z.array(
    z.object({
      id: z.number().int(),
      url: z.string().nullish(),
      event: z.string().nullish(),
      active: z.union([z.boolean(), z.number()]).nullish(),
      last_response_code: z.number().nullish(),
      last_call_time: z.string().nullish(),
      errors_in_row: z.number().nullish(),
    }),
  ),
});

export interface StavWebhooku {
  /** SmartEmailing webhook po opakovaných chybách sám vypíná. */
  aktivni: boolean;
  posledniKod: number | null;
  posledniVolani: Date | null;
  chybVRade: number;
}

/** Stav webhooku ve SmartEmailingu, nebo `null`, když tam už není. */
export async function nactiWebhook(id: number): Promise<Vysledek<StavWebhooku | null>> {
  const vysledek = await zavolej(`/web-hooks?id=${id}`);
  if (!vysledek.ok) return vysledek;

  const seznam = webhookySchema.safeParse(vysledek.data);
  if (!seznam.success) {
    return {
      ok: false,
      chyba: "nedostupne",
      detail: "Webhooky přišly v podobě, které CRM nerozumí.",
    };
  }

  const webhook = seznam.data.data.find((polozka) => polozka.id === id);
  if (!webhook) return { ok: true, data: null };

  const posledniVolani = casZeSmartemailingu(webhook.last_call_time);
  return {
    ok: true,
    data: {
      aktivni: webhook.active !== false && webhook.active !== 0,
      posledniKod: webhook.last_response_code ?? null,
      posledniVolani: posledniVolani === null ? null : new Date(posledniVolani),
      chybVRade: webhook.errors_in_row ?? 0,
    },
  };
}

const novyWebhookSchema = z.object({ id: z.number().int().positive() });

/**
 * Založí ve SmartEmailingu webhook, který při odhlášení kontaktu zavolá CRM,
 * a vrátí jeho číslo. Heslo z `.env` předá SmartEmailingu, v CRM se nikam
 * neukládá.
 *
 * Starší webhook na stejnou adresu (třeba po změně hesla) se nejdřív smaže —
 * jinak by chodilo každé odhlášení dvakrát, jednou se starým heslem.
 */
export async function zalozWebhookOdhlaseni(): Promise<Vysledek<number>> {
  const heslo = hesloWebhooku();
  const adresa = adresaWebhooku();
  if (!heslo) {
    return {
      ok: false,
      chyba: "nenastaveno",
      detail: "V .env chybí SMARTEMAILING_WEBHOOK_SECRET (aspoň 32 znaků).",
    };
  }
  if (!adresa.ok) return { ok: false, chyba: "nenastaveno", detail: adresa.duvod };

  const stavajici = await zavolej("/web-hooks?event=unsubscribed_contact");
  if (!stavajici.ok) return stavajici;

  const seznam = webhookySchema.safeParse(stavajici.data);
  if (!seznam.success) {
    return {
      ok: false,
      chyba: "nedostupne",
      detail: "Webhooky přišly v podobě, které CRM nerozumí.",
    };
  }

  for (const webhook of seznam.data.data) {
    if (webhook.url === adresa.adresa && webhook.event === "unsubscribed_contact") {
      const smazani = await smazWebhook(webhook.id);
      if (!smazani.ok) return smazani;
    }
  }

  const vysledek = await zavolej("/web-hooks", {
    method: "POST",
    body: {
      target_url: adresa.adresa,
      event: "unsubscribed_contact",
      basic_auth: { login: JMENO_WEBHOOKU, password: heslo },
    },
  });
  if (!vysledek.ok) return vysledek;

  const novy = novyWebhookSchema.safeParse(vysledek.data);
  if (!novy.success) {
    return {
      ok: false,
      chyba: "nedostupne",
      detail: "SmartEmailing nevrátil číslo webhooku. Zkontroluj webhooky přímo ve SmartEmailingu.",
    };
  }
  return { ok: true, data: novy.data.id };
}

/** Smaže webhook ve SmartEmailingu. Ten, který tam už není, je taky smazaný. */
export async function smazWebhook(id: number): Promise<Vysledek<null>> {
  const vysledek = await zavolej(`/web-hooks/${id}`, { method: "DELETE" });
  if (vysledek.ok || vysledek.detail.startsWith("HTTP 404")) return { ok: true, data: null };
  return vysledek;
}

/* ---------- Odhlášení ---------- */

const odhlaseniSchema = z.object({
  data: z.array(
    z.object({
      emailaddress: z.string(),
      // SmartEmailing posílá 0 / 1; pro jistotu se bere i true / false.
      hardbounced: z.union([z.number(), z.boolean()]).nullish(),
      updated: z.string().nullish(),
      contactlists: z
        .array(
          z.object({
            contactlist_id: z.number(),
            added: z.string().nullish(),
            updated: z.string().nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

/** Kolik kontaktů SmartEmailing vrací na jednu stránku. */
const NA_STRANKU_API = 500;

/**
 * Kontakt změněný v posledních 10 minutách se při načtení odhlášených
 * přeskočí (Jakub, 13. 9. 2026).
 *
 * SmartEmailing vede nedoručitelnou adresu zhruba minutu jen jako
 * zablokovanou a teprve pak ji označí `hardbounced`. Kdo by načetl
 * odhlášené v téhle chvíli, odebral by souhlas člověku, který ho
 * neodvolal. Deset minut je s rezervou; kontakt se vezme při dalším načtení.
 */
const ODKLAD_CERSTVE_ZMENY_MS = 10 * 60 * 1000;

/** V jakém pásmu SmartEmailing posílá časy („2026-09-13 22:35:10", bez pásma). */
const PASMO_SMARTEMAILINGU = "Europe/Prague";

/** Čas ze SmartEmailingu jako milisekundy od roku 1970, nebo `null`, když mu nerozumíme. */
function casZeSmartemailingu(text: string | null | undefined): number | null {
  const casti = text ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim()) : null;
  if (!casti) return null;

  const [rok, mesic, den, hodina, minuta, sekunda] = casti.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const jakoUtc = Date.UTC(rok, mesic - 1, den, hodina, minuta, sekunda);

  // Posun pražského času proti UTC v danou chvíli (zimní 1 h, letní 2 h).
  const vPraze = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: PASMO_SMARTEMAILINGU,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(jakoUtc))
      .map((cast) => [cast.type, cast.value]),
  );
  const prahaJakoUtc = Date.UTC(
    Number(vPraze.year),
    Number(vPraze.month) - 1,
    Number(vPraze.day),
    Number(vPraze.hour),
    Number(vPraze.minute),
    Number(vPraze.second),
  );

  return jakoUtc - (prahaJakoUtc - jakoUtc);
}

export interface OdhlaseneKontakty {
  /** Odhlásili se sami, nebo je SmartEmailing zablokoval — souhlas se odebírá. */
  odhlasene: string[];
  /** Zpráva se vrátila, adresa neexistuje — souhlas neodvolali (Jakub, 13. 9. 2026). */
  nedorucitelne: string[];
  /** Kolik kontaktů se přeskočilo, protože se ve SmartEmailingu změnily před chvílí. */
  odlozene: number;
}

/**
 * Kontakty, které SmartEmailing u daného seznamu vede jako odhlášené nebo
 * zablokované, malými písmeny a rozdělené podle toho, proč tam jsou.
 *
 * SmartEmailing nedoručitelné adresy (hardbounce) vrací ve stejném výpisu
 * jako odhlášené — rozlišují se podle příznaku `hardbounced`. Kontakty
 * změněné v posledních 10 minutách se přeskočí (`ODKLAD_CERSTVE_ZMENY_MS`).
 *
 * Adresy se drží jen v paměti po dobu porovnání s CRM — nikam se neukládají
 * ani nelogují (pravidlo 8).
 */
export async function nactiOdhlaseneEmaily(seznamId: number): Promise<Vysledek<OdhlaseneKontakty>> {
  const odhlasene = new Set<string>();
  const nedorucitelne = new Set<string>();
  const videne = new Set<string>();
  let odlozene = 0;
  const hranice = Date.now() - ODKLAD_CERSTVE_ZMENY_MS;

  for (let offset = 0; offset < 100 * NA_STRANKU_API; offset += NA_STRANKU_API) {
    const vysledek = await zavolej(
      `/contactlists/${seznamId}/contacts/unsubscribed?limit=${NA_STRANKU_API}&offset=${offset}`,
    );
    if (!vysledek.ok) return vysledek;

    const stranka = odhlaseniSchema.safeParse(vysledek.data);
    if (!stranka.success) {
      return {
        ok: false,
        chyba: "nedostupne",
        detail: "Odhlášené kontakty přišly v podobě, které CRM nerozumí.",
      };
    }

    const kontakty = stranka.data.data;

    // Kdyby SmartEmailing stránkování ignoroval a vracel pořád totéž,
    // cyklus by jinak jel stokrát naprázdno.
    const prvni = kontakty[0]?.emailaddress.trim().toLowerCase();
    if (prvni && videne.has(prvni)) break;

    for (const kontakt of kontakty) {
      const adresa = kontakt.emailaddress.trim().toLowerCase();
      videne.add(adresa);

      const clenstvi = kontakt.contactlists?.find((c) => c.contactlist_id === seznamId);
      // Čas, kterému nerozumíme, se nebere jako čerstvý — jinak by se při
      // změně formátu u SmartEmailingu nenačetl už nikdy nikdo.
      const cerstvy = [kontakt.updated, clenstvi?.updated, clenstvi?.added]
        .map(casZeSmartemailingu)
        .some((cas) => cas !== null && cas > hranice);

      if (cerstvy) {
        odlozene += 1;
        continue;
      }

      const nedorucitelny = kontakt.hardbounced === 1 || kontakt.hardbounced === true;
      (nedorucitelny ? nedorucitelne : odhlasene).add(adresa);
    }

    if (kontakty.length < NA_STRANKU_API) break;
  }

  return {
    ok: true,
    data: { odhlasene: [...odhlasene], nedorucitelne: [...nedorucitelne], odlozene },
  };
}

/* ---------- Odeslání klienta ---------- */

/**
 * Klient má v CRM jedno pole na jméno, SmartEmailing dvě. Příjmení je
 * poslední slovo („Jana Marie Nováková" → Jana Marie / Nováková).
 */
export function rozdelJmeno(cele: string): { name: string; surname: string | null } {
  const jmeno = cele.trim().replace(/\s+/g, " ");
  const mezera = jmeno.lastIndexOf(" ");
  if (mezera === -1) return { name: jmeno, surname: null };
  return { name: jmeno.slice(0, mezera), surname: jmeno.slice(mezera + 1) };
}

/** Proč klienta nejde odeslat, i když propojení běží. */
export type DuvodNeodeslani = "smazany" | "bez-emailu" | "bez-souhlasu";

export const POPIS_DUVODU_NEODESLANI: Record<DuvodNeodeslani, string> = {
  smazany: "Klient je smazaný.",
  "bez-emailu": "Klient nemá e-mail.",
  "bez-souhlasu": "Klient už nemá souhlas s marketingem.",
};

export type VysledekOdeslani =
  | { stav: "odeslano" }
  | { stav: "chyba"; chyba: ChybaSmartemailingu }
  /** Propojení je vypnuté nebo nemá vybraný seznam. */
  | { stav: "vypnuto" }
  | { stav: "nelze"; duvod: DuvodNeodeslani }
  /** Není co dělat — chyba už je vyřešená, nebo klient mezitím odešel. */
  | { stav: "vyreseno" };

/**
 * Proč se odesílá:
 * - `novy` — právě založený klient,
 * - `znovu` — administrátor posílá znovu po chybě,
 * - `hromadne` — hromadné odeslání klientů, kteří ještě neodešli,
 * - `uprava` — klientovi někdo zaškrtl souhlas nebo změnil e-mail,
 * - `rucne` — tlačítko Poslat do SmartEmailingu na kartě klienta,
 * - `objednavka` — známý klient zaškrtl souhlas při objednávce na
 *   Landing Page (Jakub, 23. 9. 2026).
 */
type Rezim = "novy" | "znovu" | "hromadne" | "uprava" | "rucne" | "objednavka";

/**
 * Samotné odeslání: kontrola propojení a souhlasu, volání SmartEmailingu,
 * zápis výsledku ke klientovi a do auditu v jedné transakci.
 */
async function odesli(
  clientId: string,
  userId: string | null,
  rezim: Rezim,
): Promise<VysledekOdeslani> {
  const nastaveni = await nactiNastaveni();
  const seznam = nastaveni.smartemailingListId;
  if (!nastaveni.smartemailingEnabled || seznam === null) return { stav: "vypnuto" };

  const klient = await db.client.findUnique({
    where: { id: clientId },
    select: {
      name: true,
      email: true,
      consentMarketingAt: true,
      deletedAt: true,
      smartemailingSentAt: true,
      smartemailingError: true,
    },
  });
  if (!klient || (rezim === "znovu" && klient.smartemailingError === null)) {
    // Není co posílat — klient mezitím odešel nebo zmizel. Visící chyba
    // v sekci Chyby by jinak zůstala otevřená navždy.
    if (rezim === "znovu") {
      await vyresChyby(
        { druh: "smartemailing.klient", clientId },
        { zpusob: "vyreseno", kdoId: userId },
      );
    }
    return { stav: "vyreseno" };
  }
  // Hromadné odeslání si seznam klientů načte předem — mezitím mohl
  // klient odejít sám nebo skončit chybou, kterou řeší Odeslat znovu.
  if (
    rezim === "hromadne" &&
    (klient.smartemailingSentAt !== null || klient.smartemailingError !== null)
  ) {
    return { stav: "vyreseno" };
  }

  const duvod: DuvodNeodeslani | null = klient.deletedAt
    ? "smazany"
    : !klient.email
      ? "bez-emailu"
      : !klient.consentMarketingAt
        ? "bez-souhlasu"
        : null;

  if (duvod || !klient.email) {
    // U nového klienta ani u hromadného odeslání se nic neděje. U opakování
    // se chyba uzavře — jinak by v seznamu visela navždy, přestože poslat
    // už nic nejde.
    if (rezim === "znovu" && duvod) {
      await db.$transaction(async (tx) => {
        await tx.client.update({
          where: { id: clientId },
          data: { smartemailingError: null, smartemailingErrorDetail: null },
        });
        await zapisDoAuditu(tx, {
          userId,
          entity: "clients",
          entityId: clientId,
          action: "klient.smartemailing-uzavreno",
          after: { duvod },
        });
      });
      await vyresChyby(
        { druh: "smartemailing.klient", clientId },
        { zpusob: "uzavreno", kdoId: userId },
      );
    }
    return { stav: "nelze", duvod: duvod ?? "bez-emailu" };
  }

  const { name, surname } = rozdelJmeno(klient.name);

  const vysledek = await zavolej("/import", {
    method: "POST",
    body: {
      settings: {
        // Kontakt, který ve SmartEmailingu už je, dostane jméno z CRM.
        update: true,
        // Automaticky (nový klient, hromadně) zůstane odhlášený odhlášený —
        // CRM mu souhlas ještě nemuselo odebrat. Po vědomém kroku člověka
        // (úprava, tlačítko, Znovu spustit) rozhoduje souhlas v CRM
        // (Jakub, 15. 9. 2026).
        preserve_unsubscribed: rezim === "novy" || rezim === "hromadne",
        skip_invalid_emails: false,
        // Oslovení a svátek si SmartEmailing dopočítá ze jména sám.
        add_namedays: true,
        add_genders: true,
        add_salutions: true,
      },
      data: [
        {
          emailaddress: klient.email,
          name,
          ...(surname ? { surname } : {}),
          // Souhlas je zaznamenaný v CRM, proto rovnou potvrzený — bez
          // dalšího potvrzovacího e-mailu.
          contactlists: [{ id: seznam, status: "confirmed" }],
        },
      ],
    },
  });

  const ted = new Date();
  const nazevSeznamu = nastaveni.smartemailingListName ?? String(seznam);

  await db.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: vysledek.ok
        ? {
            smartemailingSentAt: ted,
            smartemailingError: null,
            smartemailingErrorDetail: null,
            smartemailingAttemptAt: ted,
            smartemailingListName: nazevSeznamu,
            smartemailingUnsubscribedAt: null,
            // Odešel se souhlasem — dřívější odhlášení z odběru už neplatí.
            smartemailingOptedOutAt: null,
          }
        : {
            smartemailingError: vysledek.chyba,
            smartemailingErrorDetail: vysledek.detail,
            smartemailingAttemptAt: ted,
          },
    });

    // Do auditu jen kód chyby — popis se drží u klienta, audit je trvalý.
    await zapisDoAuditu(tx, {
      userId,
      entity: "clients",
      entityId: clientId,
      action: vysledek.ok ? "klient.smartemailing" : "klient.smartemailing-chyba",
      after: {
        seznam: nazevSeznamu,
        ...(rezim === "znovu" ? { znovu: true } : {}),
        ...(rezim === "hromadne" ? { hromadne: true } : {}),
        ...(rezim === "uprava" ? { uprava: true } : {}),
        ...(rezim === "rucne" ? { rucne: true } : {}),
        ...(rezim === "objednavka" ? { objednavka: true } : {}),
        ...(vysledek.ok ? {} : { chyba: vysledek.chyba }),
      },
    });
  });

  // Sekce Chyby (Jakub, 15. 9. 2026): selhání se tam zapíše, úspěch
  // vyřeší případnou dřívější chybu téhož klienta.
  if (vysledek.ok) {
    await vyresChyby(
      { druh: "smartemailing.klient", clientId },
      { zpusob: "vyreseno", kdoId: userId },
    );
  } else {
    await zapisChybu({
      druh: "smartemailing.klient",
      kod: vysledek.chyba,
      detail: vysledek.detail,
      clientId,
      spustilId: userId,
    });
  }

  return vysledek.ok ? { stav: "odeslano" } : { stav: "chyba", chyba: vysledek.chyba };
}

/**
 * Pošle právě založeného klienta do vybraného seznamu odběratelů.
 *
 * Volá se přes `after()` ze zakládání klienta, takže **nesmí nic vyhodit**.
 * Když je propojení vypnuté, klient nemá e-mail nebo souhlas, neudělá
 * nic a nic ani nezapisuje. Jinak zapíše výsledek ke klientovi a do
 * auditního logu — osobní údaje z CRM odešly ven, musí to být dohledatelné.
 *
 * `userId` je ten, kdo klienta založil: odeslání spustila jeho změna.
 * U klienta přijatého z webu je `null` — změnu neudělal člověk.
 */
export async function odesliNovehoKlienta(clientId: string, userId: string | null): Promise<void> {
  try {
    const vysledek = await odesli(clientId, userId, "novy");
    if (vysledek.stav === "chyba") console.error("SmartEmailing: klient neodešel:", vysledek.chyba);
  } catch (chyba) {
    // Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu.
    console.error(
      "SmartEmailing: odeslání klienta selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/**
 * Známý klient zaškrtl souhlas s marketingem při objednávce na Landing
 * Page (Jakub, 23. 9. 2026).
 *
 * **Rozhoduje souhlas v CRM**, ne `preserve_unsubscribed` — zaškrtnutí je
 * nový, vědomě daný souhlas, takže se klient přihlásí i po dřívějším
 * odhlášení. Stejně jako po úpravě klienta člověkem. „Kdo" je prázdné,
 * změnu neudělal nikdo z týmu. Volá se přes `after()`, **nesmí nic
 * vyhodit**.
 */
export async function odesliSouhlasZObjednavky(clientId: string): Promise<void> {
  try {
    const vysledek = await odesli(clientId, null, "objednavka");
    if (vysledek.stav === "chyba") console.error("SmartEmailing: klient neodešel:", vysledek.chyba);
  } catch (chyba) {
    console.error(
      "SmartEmailing: odeslání klienta z objednávky selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/**
 * Opakované odeslání klienta, u kterého se to nepovedlo. Spouští ho
 * **jen administrátor** v sekci Chyby — roli ověřuje serverová akce,
 * která tohle volá. Posílá aktuální údaje z karty.
 */
export function odesliZnovu(clientId: string, userId: string): Promise<VysledekOdeslani> {
  return odesli(clientId, userId, "znovu");
}

/**
 * Jeden klient z hromadného odeslání. Roli ověřuje serverová akce, která
 * hromadné odeslání spouští (`smartemailing-synchronizace.ts`).
 */
export function odesliVHromadnemOdeslani(
  clientId: string,
  userId: string,
): Promise<VysledekOdeslani> {
  return odesli(clientId, userId, "hromadne");
}

/* ---------- Úprava klienta ---------- */

const hledaniKontaktuSchema = z.object({ data: z.array(z.object({ id: z.number() })) });

/**
 * Odhlásí e-mail ze seznamu odběratelů. Kontakt ve SmartEmailingu zůstane
 * i s historií kampaní, jen dostane stav Odhlášený (Jakub, 15. 9. 2026).
 *
 * Adresu, kterou SmartEmailing nezná, nechá být — import by ji jinak
 * založil jako nový odhlášený kontakt.
 */
async function odhlasZeSeznamu(email: string, seznam: number): Promise<Vysledek<null>> {
  const hledani = await zavolej(`/contacts?emailaddress=${encodeURIComponent(email)}`);
  if (!hledani.ok) return hledani;

  const nalezene = hledaniKontaktuSchema.safeParse(hledani.data);
  if (nalezene.success && nalezene.data.data.length === 0) return { ok: true, data: null };

  const vysledek = await zavolej("/import", {
    method: "POST",
    body: {
      settings: { update: true, preserve_unsubscribed: true, skip_invalid_emails: false },
      data: [{ emailaddress: email, contactlists: [{ id: seznam, status: "unsubscribed" }] }],
    },
  });
  return vysledek.ok ? { ok: true, data: null } : vysledek;
}

type VysledekOdhlaseniKlienta = "odhlaseno" | "vypnuto" | ChybaSmartemailingu;

/**
 * Odhlásí klienta — nebo jeho starou adresu po změně e-mailu — a zapíše
 * výsledek do auditu, případně do sekce Chyby.
 */
async function odhlasKlienta(
  clientId: string,
  userId: string | null,
  email: string,
  staraAdresa: boolean,
): Promise<VysledekOdhlaseniKlienta> {
  const nastaveni = await nactiNastaveni();
  const seznam = nastaveni.smartemailingListId;
  if (!nastaveni.smartemailingEnabled || seznam === null) return "vypnuto";

  const vysledek = await odhlasZeSeznamu(email, seznam);

  if (!vysledek.ok) {
    await zapisChybu({
      druh: "smartemailing.odhlaseni-klienta",
      kod: vysledek.chyba,
      detail: `${staraAdresa ? "Stará adresa po změně e-mailu. " : ""}${vysledek.detail}`,
      clientId,
      spustilId: userId,
    });
    return vysledek.chyba;
  }

  await db.$transaction(async (tx) => {
    // U staré adresy klient zůstává přihlášený pod novou — značka se nedává.
    if (!staraAdresa) {
      await tx.client.update({
        where: { id: clientId },
        data: { smartemailingUnsubscribedAt: new Date() },
      });
    }
    await zapisDoAuditu(tx, {
      userId,
      entity: "clients",
      entityId: clientId,
      action: "klient.smartemailing-odhlasen",
      after: {
        seznam: nastaveni.smartemailingListName ?? String(seznam),
        ...(staraAdresa ? { staraAdresa: true } : {}),
      },
    });
  });

  if (!staraAdresa) {
    await vyresChyby(
      { druh: "smartemailing.odhlaseni-klienta", clientId },
      { zpusob: "vyreseno", kdoId: userId },
    );
  }
  return "odhlaseno";
}

/** Souhlas a e-mail klienta před úpravou a po ní. */
export interface StavKlientaProSmartemailing {
  email: string;
  souhlas: boolean;
}

/**
 * Propíše úpravu klienta do SmartEmailingu (Jakub, 15. 9. 2026):
 *
 * - **souhlas zaškrtnutý** → klient se přihlásí,
 * - **souhlas odebraný** → klient se ze seznamu odhlásí,
 * - **nový e-mail u klienta se souhlasem** → nová adresa se přihlásí
 *   a stará, pokud do SmartEmailingu dřív odešla, se odhlásí.
 *
 * Rozhoduje souhlas v CRM: po úpravě se přihlásí i ten, kdo se ve
 * SmartEmailingu dřív odhlásil. Odhlašuje se jen adresa, která do
 * SmartEmailingu někdy odešla. Volá se přes `after()` z úpravy klienta,
 * takže **nesmí nic vyhodit**.
 */
export async function propisUpravuKlienta(
  clientId: string,
  /** Kdo úpravu udělal. Prázdné, když si údaje změnil klient sám (klientská část). */
  userId: string | null,
  pred: StavKlientaProSmartemailing,
  po: StavKlientaProSmartemailing,
): Promise<void> {
  try {
    const klient = await db.client.findUnique({
      where: { id: clientId },
      select: { smartemailingSentAt: true },
    });
    if (!klient) return;

    const odeslanyDriv = klient.smartemailingSentAt !== null;
    const zmenaEmailu = pred.email !== po.email;

    if (po.souhlas && (!pred.souhlas || zmenaEmailu)) {
      const vysledek = await odesli(clientId, userId, "uprava");
      // Starou adresu odhlásit až ve chvíli, kdy nová opravdu odešla —
      // jinak by klient ve SmartEmailingu nebyl přihlášený vůbec.
      if (vysledek.stav === "odeslano" && odeslanyDriv && pred.souhlas && zmenaEmailu) {
        await odhlasKlienta(clientId, userId, pred.email, true);
      }
      return;
    }

    if (pred.souhlas && !po.souhlas && odeslanyDriv) {
      await odhlasKlienta(clientId, userId, pred.email, false);
    }
  } catch (chyba) {
    // Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu.
    console.error(
      "SmartEmailing: propsání úpravy klienta selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/**
 * Tlačítko Poslat do SmartEmailingu na kartě klienta — aktuální údaje,
 * rozhoduje souhlas v CRM. **Jen administrátor**; roli ověřuje serverová
 * akce, která tohle volá.
 */
export function posliKlientaRucne(clientId: string, userId: string): Promise<VysledekOdeslani> {
  return odesli(clientId, userId, "rucne");
}

/**
 * Znovu spustit u chyby odhlášení (sekce Chyby). Odhlásí aktuální e-mail
 * klienta, pokud pořád nemá souhlas. Když ho mezitím zase má, není co
 * odhlašovat — u staré adresy po změně e-mailu je potřeba ruční odhlášení.
 */
export async function odhlasKlientaZnovu(
  clientId: string,
  userId: string,
): Promise<VysledekOdhlaseniKlienta | "ma-souhlas" | "neni"> {
  const klient = await db.client.findUnique({
    where: { id: clientId },
    select: { email: true, consentMarketingAt: true },
  });
  if (!klient) return "neni";
  if (klient.consentMarketingAt) return "ma-souhlas";
  return odhlasKlienta(clientId, userId, klient.email, false);
}
