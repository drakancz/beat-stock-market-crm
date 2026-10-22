import { createHash, createSign } from "node:crypto";

import { after } from "next/server";

import { vyresChyby, zapisChybu } from "@/lib/chyby";
import { db } from "@/lib/db";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Konzultace v Google Kalendáři (Jakub, 20. 10. 2026).
 *
 * Rezervace konzultace se zapíše jako událost do **jednoho firemního
 * kalendáře**; zrušení ji smaže, přeložení = smazání staré a zápis nové.
 * Připojuje a odpojuje **jen administrátor** v Nastavení → Kalendář.
 *
 * **Přihlášení servisním účtem Googlu**: kalendář je nasdílený s jeho
 * adresou („Provádět změny událostí“) a CRM vidí jen tenhle kalendář.
 * Klíč je jen v prostředí — `GOOGLE_KALENDAR_UCET` (adresa účtu)
 * a `GOOGLE_KALENDAR_KLIC` (soukromý klíč z JSON souboru). **Bez nich je
 * funkce vypnutá.** Přístupový token se podepisuje tady (RS256), knihovna
 * Googlu by kvůli dvěma požadavkům přinesla desítky balíčků.
 *
 * **V události je jen jméno klienta, čas, místo, odkaz na připojení a kdo
 * vede — nikdy e-mail ani telefon** (výjimka z pravidla 8, `security.md`,
 * oddíl 10). Klient se do události nezve, pozvánka by Googlu dala jeho
 * e-mail.
 *
 * ID události se odvozuje z ID rezervace (`idUdalosti()`), takže se nic
 * neukládá a zápis jde bezpečně opakovat. Zapisuje se až po odpovědi
 * (`after()`); výpadek Googlu rezervaci neshodí, jen se objeví v Chybách
 * (`kalendar.zapis`).
 *
 * V automatických testech míří `GOOGLE_KALENDAR_API` a
 * `GOOGLE_KALENDAR_TOKEN_URL` na napodobeninu v kontejneru
 * (`e2e/napodobenina-google-kalendare.mjs`) — ven nic neodchází.
 */

const VYCHOZI_API = "https://www.googleapis.com/calendar/v3";
const VYCHOZI_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ROZSAH = "https://www.googleapis.com/auth/calendar.events";
const ODPOVED_DO_MS = 10_000;
const PASMO = "Europe/Prague";

interface Ucet {
  email: string;
  klic: string;
  api: string;
  tokenUrl: string;
}

/** Servisní účet z prostředí, nebo `null`, když na serveru není. */
function servisniUcet(): Ucet | null {
  // Ukázka nepošle ven nic (src/lib/ukazka.ts) — kalendář je jako nenastavený.
  if (jeUkazka()) return null;
  const email = process.env.GOOGLE_KALENDAR_UCET?.trim();
  // Na Railway se klíč vkládá jako jeden řádek s `\n` místo konců řádků.
  const klic = process.env.GOOGLE_KALENDAR_KLIC?.replace(/\\n/g, "\n").trim();
  if (!email || !klic?.includes("PRIVATE KEY")) return null;
  return {
    email,
    klic,
    api: (process.env.GOOGLE_KALENDAR_API?.trim() || VYCHOZI_API).replace(/\/$/, ""),
    tokenUrl: process.env.GOOGLE_KALENDAR_TOKEN_URL?.trim() || VYCHOZI_TOKEN_URL,
  };
}

/** Adresa servisního účtu pro Nastavení (není tajná), nebo `null`. */
export function adresaServisnihoUctu(): string | null {
  return servisniUcet()?.email ?? null;
}

export class ChybaKalendare extends Error {
  constructor(
    zprava: string,
    readonly kod: string,
  ) {
    super(zprava);
  }
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Přístupový token v paměti procesu, dokud neprojde. */
let ulozenyToken: { email: string; token: string; do: number } | null = null;

async function token(ucet: Ucet): Promise<string> {
  if (ulozenyToken?.email === ucet.email && ulozenyToken.do > Date.now() + 60_000) {
    return ulozenyToken.token;
  }

  const ted = Math.floor(Date.now() / 1000);
  const hlavicka = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const obsah = base64url(
    JSON.stringify({
      iss: ucet.email,
      scope: ROZSAH,
      aud: ucet.tokenUrl,
      iat: ted,
      exp: ted + 3600,
    }),
  );
  let podpis: string;
  try {
    podpis = createSign("RSA-SHA256").update(`${hlavicka}.${obsah}`).sign(ucet.klic, "base64url");
  } catch {
    throw new ChybaKalendare("Klíč servisního účtu na serveru nejde přečíst.", "klic");
  }

  const odpoved = await fetch(ucet.tokenUrl, {
    method: "POST",
    signal: AbortSignal.timeout(ODPOVED_DO_MS),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${hlavicka}.${obsah}.${podpis}`,
    }),
  });
  if (!odpoved.ok) {
    throw new ChybaKalendare(
      "Google odmítl klíč servisního účtu — je platný a nesmazaný?",
      String(odpoved.status),
    );
  }
  const data = (await odpoved.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new ChybaKalendare("Google nevrátil přístupový token.", "token");
  ulozenyToken = {
    email: ucet.email,
    token: data.access_token,
    do: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/** Srozumitelný důvod podle odpovědi Googlu. */
function duvod(status: number): string {
  if (status === 404) {
    return "Kalendář se nenašel — je ID správně a je kalendář nasdílený se servisním účtem?";
  }
  if (status === 403) {
    return "Servisní účet nesmí měnit události — při sdílení vyber „Provádět změny událostí“.";
  }
  if (status === 401) return "Google odmítl přístupový token.";
  return `Google odpověděl chybou ${status}.`;
}

async function volej(
  ucet: Ucet,
  metoda: "GET" | "POST" | "PUT" | "DELETE",
  cesta: string,
  telo?: unknown,
): Promise<Response> {
  return fetch(`${ucet.api}${cesta}`, {
    method: metoda,
    signal: AbortSignal.timeout(ODPOVED_DO_MS),
    headers: {
      Authorization: `Bearer ${await token(ucet)}`,
      ...(telo ? { "Content-Type": "application/json" } : {}),
    },
    body: telo ? JSON.stringify(telo) : undefined,
    redirect: "error",
  });
}

interface Pripojeni {
  ucet: Ucet;
  kalendar: string;
}

/** Zapnuté napojení, nebo `null` (chybí klíč, ID kalendáře nebo je vypnuté). */
async function pripojeni(): Promise<Pripojeni | null> {
  const ucet = servisniUcet();
  if (!ucet) return null;
  const nastaveni = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { googleCalendarId: true, googleCalendarActive: true },
  });
  if (!nastaveni?.googleCalendarActive || !nastaveni.googleCalendarId) return null;
  return { ucet, kalendar: nastaveni.googleCalendarId };
}

const cestaKalendare = (kalendar: string) => `/calendars/${encodeURIComponent(kalendar)}/events`;

/**
 * ID události z ID rezervace. Google bere jen znaky `a–v` a `0–9`
 * (base32hex), délku 5–1024 — šestnáctková čísla otisku se do toho vejdou.
 */
export function idUdalosti(bookingId: string): string {
  return `crm${createHash("sha256").update(bookingId).digest("hex").slice(0, 40)}`;
}

/** Událost k rezervaci — výčtem polí, bez kontaktů. */
async function udalost(bookingId: string) {
  const rezervace = await db.consultationBooking.findUnique({
    where: { id: bookingId },
    select: {
      cancelledAt: true,
      client: { select: { name: true } },
      slot: {
        select: {
          startsAt: true,
          durationMinutes: true,
          place: true,
          joinUrl: true,
          deletedAt: true,
          host: { select: { name: true } },
        },
      },
    },
  });
  if (!rezervace) return null;
  const { slot } = rezervace;
  const konec = new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000);
  const popis = [
    slot.host ? `Vede: ${slot.host.name}` : null,
    slot.joinUrl ? `Připojení: ${slot.joinUrl}` : null,
    "Rezervace z CRM Beat Stock Market.",
  ].filter(Boolean);

  return {
    zrusena: !!rezervace.cancelledAt || !!slot.deletedAt,
    telo: {
      id: idUdalosti(bookingId),
      status: "confirmed",
      summary: `Konzultace – ${rezervace.client.name}`,
      ...(slot.place ? { location: slot.place } : {}),
      description: popis.join("\n"),
      start: { dateTime: slot.startsAt.toISOString(), timeZone: PASMO },
      end: { dateTime: konec.toISOString(), timeZone: PASMO },
    },
  };
}

/**
 * Srovná událost s rezervací: platná se zapíše (nebo přepíše), zrušená
 * smaže. Jde volat opakovaně.
 */
async function srovnej(p: Pripojeni, bookingId: string): Promise<void> {
  const data = await udalost(bookingId);
  if (!data) return;
  const cesta = cestaKalendare(p.kalendar);
  const id = idUdalosti(bookingId);

  if (data.zrusena) {
    const odpoved = await volej(p.ucet, "DELETE", `${cesta}/${id}`);
    // Už smazaná (410) nebo nikdy nezapsaná (404) — v pořádku.
    if (!odpoved.ok && odpoved.status !== 404 && odpoved.status !== 410) {
      throw new ChybaKalendare(duvod(odpoved.status), String(odpoved.status));
    }
    return;
  }

  let odpoved = await volej(p.ucet, "POST", cesta, data.telo);
  // Událost s tímhle ID už existuje (i smazaná) — přepsat ji.
  if (odpoved.status === 409) odpoved = await volej(p.ucet, "PUT", `${cesta}/${id}`, data.telo);
  if (!odpoved.ok) throw new ChybaKalendare(duvod(odpoved.status), String(odpoved.status));
}

async function zapisNeboChyba(p: Pripojeni, bookingIds: string[]): Promise<number> {
  let chyb = 0;
  for (const bookingId of bookingIds) {
    try {
      await srovnej(p, bookingId);
    } catch (chyba) {
      chyb += 1;
      await zapisChybu({
        druh: "kalendar.zapis",
        kod: chyba instanceof ChybaKalendare ? chyba.kod : "spojeni",
        detail:
          chyba instanceof ChybaKalendare ? chyba.message : "Google Kalendář neodpověděl včas.",
      });
    }
  }
  if (chyb === 0 && bookingIds.length > 0) {
    await vyresChyby({ druh: "kalendar.zapis" }, { zpusob: "vyreseno", kdoId: null });
  }
  return chyb;
}

/**
 * Promítne rezervace do kalendáře — až po odpovědi. **Nikdy nevyhazuje**:
 * výpadek Googlu nesmí shodit rezervaci. Když napojení není zapnuté,
 * nedělá nic.
 */
export function zapisDoKalendare(...bookingIds: string[]): void {
  const prace = async () => {
    try {
      const p = await pripojeni();
      if (p) await zapisNeboChyba(p, bookingIds);
    } catch (chyba) {
      console.error("Kalendář selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    }
  };
  try {
    after(prace);
  } catch {
    // Mimo požadavek (skript) `after()` nejde — rovnou.
    void prace();
  }
}

/** Zkouška z Nastavení: dostane se CRM ke kalendáři? Vrací důvod, nebo `null`. */
export async function vyzkousejKalendar(kalendar: string): Promise<string | null> {
  const ucet = servisniUcet();
  if (!ucet) return "Na serveru chybí klíč servisního účtu (GOOGLE_KALENDAR_UCET a _KLIC).";
  try {
    const odpoved = await volej(ucet, "GET", `${cestaKalendare(kalendar)}?maxResults=1`);
    return odpoved.ok ? null : duvod(odpoved.status);
  } catch (chyba) {
    return chyba instanceof ChybaKalendare ? chyba.message : "Google Kalendář neodpověděl včas.";
  }
}

/**
 * Zapíše všechny budoucí platné rezervace — po připojení kalendáře nebo po
 * výpadku. Vrací, kolik se jich zapsalo a kolik selhalo.
 */
export async function zapisBudouciRezervace(): Promise<
  { ok: true; zapsano: number; chyb: number } | { ok: false; chyba: string }
> {
  const p = await pripojeni();
  if (!p) return { ok: false, chyba: "Napojení na kalendář není zapnuté." };
  const rezervace = await db.consultationBooking.findMany({
    where: {
      cancelledAt: null,
      slot: { deletedAt: null, startsAt: { gte: new Date() } },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const chyb = await zapisNeboChyba(
    p,
    rezervace.map((r) => r.id),
  );
  return { ok: true, zapsano: rezervace.length - chyb, chyb };
}
