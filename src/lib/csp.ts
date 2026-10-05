/**
 * Content-Security-Policy — seznam, odkud smí stránka v prohlížeči co
 * načítat (Jakub, 5. 10. 2026).
 *
 * Hlavní smysl je **zastavit cizí skript**. Kdyby se do stránky přes
 * nějakou chybu dostal kus HTML se skriptem (třeba ve jméně klienta),
 * prohlížeč ho nespustí — skripty běží jen s jednorázovým klíčem
 * (`nonce`), který server vymyslí pro každé načtení stránky a útočník ho
 * nezná. Next.js klíč na své skripty doplní sám; ručně ho dostává jen
 * skript přepínače vzhledu (`ThemeProvider` v kořenovém rámu).
 *
 * Postup je podle návodu Next.js 16.3 (`02-guides/content-security-policy.md`):
 * klíč vzniká v `proxy.ts`, jde do hlavičky požadavku (odkud si ho Next.js
 * vezme) i odpovědi (kterou čte prohlížeč). **Každá stránka se proto
 * vykresluje až na požádání** — zajišťuje to čtení klíče v kořenovém rámu.
 *
 * Co z toho záměrně neplyne:
 * - **Styly mají `'unsafe-inline'`.** Grafy (Recharts) a vyskakovací okna
 *   (Radix) nastavují vzhled přímo na prvcích (`style="…"`), na což klíč
 *   nestačí. Přes styly se cizí kód spustit nedá.
 * - **Hlášení o zablokování (`report-uri`) se nikam neposílá.** Nese adresu
 *   stránky a v ní bývají jména klientů z hledání (pravidlo 8).
 * - **Výdej příloh a `sw-klient.js`** mají vlastní přísnější pravidla
 *   v `next.config.ts`, proxy přes ně nejde.
 */

/** Náhodný klíč pro jedno načtení stránky — 128 bitů v base64. */
export function novyNonce(): string {
  const bajty = new Uint8Array(16);
  crypto.getRandomValues(bajty);
  return btoa(String.fromCharCode(...bajty));
}

/**
 * Adresa serveru Sentry z DSN (`https://klic@o1.ingest.de.sentry.io/123`
 * → `https://o1.ingest.de.sentry.io`). Prohlížeč na ni posílá hlášení
 * chyb. Bez DSN nebo s nesmyslným DSN se nepovoluje nic.
 */
function adresaSentry(dsn: string | undefined): string | null {
  if (!dsn?.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export type NastaveniCsp = {
  nonce: string;
  /** `next dev` potřebuje `eval` (ladicí výpisy Reactu) a websocket pro obnovu. */
  vyvoj: boolean;
  /** Běží aplikace na https? Jen pak se smí vynutit https u všeho načítaného. */
  https: boolean;
  /** `NEXT_PUBLIC_SENTRY_DSN` — kam smí prohlížeč hlásit chyby. */
  sentryDsn?: string;
};

export function hlavickaCsp({ nonce, vyvoj, https, sentryDsn }: NastaveniCsp): string {
  const sentry = adresaSentry(sentryDsn);

  const pravidla: Record<string, string[]> = {
    "default-src": ["'self'"],
    /*
     * `'strict-dynamic'`: skript s klíčem smí načíst další skripty (tak
     * Next.js nahrává části aplikace). `'self'` tím prohlížeč ignoruje,
     * zůstává jen pro hodně staré prohlížeče.
     */
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(vyvoj ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    /*
     * Loga brokerů jsou odkazy na cizí servery, které zadává administrátor
     * (jen `https`, `brokeri/actions.ts`). `data:` a `blob:` jsou náhledy
     * a QR kód dvoufázového ověření.
     */
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    /*
     * Rámy: náhled přílohy (`/api/soubory/…`) a videa v lekcích — jen
     * přehrávače, jejichž adresu skládá `rozpoznejVideo()`.
     */
    "frame-src": ["'self'", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
    /*
     * Kam smí stránka posílat data: CRM, Sentry a UploadThing (soubor jde
     * z prohlížeče rovnou na `https://<region>.ingest.uploadthing.com`).
     */
    "connect-src": [
      "'self'",
      "https://*.ingest.uploadthing.com",
      ...(sentry ? [sentry] : []),
      ...(vyvoj ? ["ws:", "wss:"] : []),
    ],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const text = Object.entries(pravidla).map(([klic, hodnoty]) => `${klic} ${hodnoty.join(" ")}`);
  // Na http (vývoj, ověření produkce na localhostu) by tohle rozbilo načítání.
  if (https) text.push("upgrade-insecure-requests");
  return text.join("; ");
}
