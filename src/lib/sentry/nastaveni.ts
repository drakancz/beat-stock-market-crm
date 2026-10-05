import type { ErrorEvent, Breadcrumb } from "@sentry/nextjs";

import { bezOsobnichUdaju } from "@/lib/anonymizace";

/**
 * Společné nastavení hlášení chyb do Sentry (Jakub, 17. 9. 2026).
 *
 * Sentry je služba **mimo tenhle počítač** — co jí pošleme, zůstane na
 * jejích serverech. Systém drží osobní údaje stovek lidí, takže platí
 * přísná pravidla (security_warnings.md, pravidlo 8):
 *
 * 1. **Neposílá se nic, podle čeho jde poznat klient.** `sendDefaultPii`
 *    je vypnuté (žádné IP adresy, hlavičky ani těla požadavků) a navíc
 *    každá hláška projde `bezOsobnichUdaju()`.
 * 2. **O přihlášeném jde ven jen vnitřní ID a role** (Jakub, 17. 9. 2026),
 *    nikdy jméno ani e-mail — na serveru to nastavuje `getViewer()`
 *    (`src/lib/session.ts`), v prohlížeči `SentryUzivatel`
 *    (`src/components/sentry-uzivatel.tsx`).
 * 3. **Nahrávání obrazovky (Session Replay) se nepoužívá.** Nahrálo by
 *    jména a telefony klientů z obrazovky.
 * 4. **Bez DSN je hlášení vypnuté** a aplikace běží dál. Ve vývoji se
 *    nehlásí nic — chyby jsou vidět rovnou v okně.
 *
 * Adresa projektu (DSN) sama o sobě tajemství není (nese ji každá
 * stránka), přesto je v `.env` jako všechno ostatní.
 */

/** Zapíná se vyplněním DSN; ve vývoji zůstává hlášení vypnuté. */
export function jeZapnute(): boolean {
  return Boolean(dsn()) && process.env.NODE_ENV === "production";
}

export function dsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

/** Kolik procent požadavků se měří kvůli výkonu. */
const VZOREK_MERENI = 0.1;

/**
 * Projde texty v hlášení a vyhodí z nich e-maily a telefony.
 *
 * Sentry posílá i adresu stránky, na které chyba vznikla. Ta nese
 * hledaný výraz (`/klienti?hledat=Novák`) — parametry se proto z adres
 * zahazují, stejně jako v Aktivitě.
 */
export function ocistiUdalost(udalost: ErrorEvent): ErrorEvent | null {
  if (udalost.message) udalost.message = bezOsobnichUdaju(udalost.message);

  for (const chyba of udalost.exception?.values ?? []) {
    if (chyba.value) chyba.value = bezOsobnichUdaju(chyba.value);
  }

  if (udalost.request?.url) udalost.request.url = bezParametru(udalost.request.url);

  // Jistota pro případ, že by `sendDefaultPii` někdo zapnul: tyhle části
  // nesou hlavičky, cookies a těla požadavků.
  delete udalost.request?.cookies;
  delete udalost.request?.headers;
  delete udalost.request?.data;

  if (udalost.user) {
    udalost.user = {
      id: udalost.user.id,
      // Role se posílá schválně (podle ní se pozná, koho se chyba týká);
      // cokoli dalšího — jméno, e-mail, IP adresa — se zahazuje.
      role: (udalost.user as { role?: string }).role,
    };
  }

  udalost.breadcrumbs = udalost.breadcrumbs?.map(ocistiDrobek);

  return udalost;
}

/** Stopa kroků před chybou — i v ní se veze adresa a text. */
export function ocistiDrobek(drobek: Breadcrumb): Breadcrumb {
  const upraveny: Breadcrumb = { ...drobek };

  if (upraveny.message) upraveny.message = bezOsobnichUdaju(upraveny.message);

  const data = upraveny.data as Record<string, unknown> | undefined;
  if (data) {
    upraveny.data = Object.fromEntries(
      Object.entries(data).map(([klic, hodnota]) => [
        klic,
        typeof hodnota === "string"
          ? bezOsobnichUdaju(
              klic === "url" || klic === "to" || klic === "from" ? bezParametru(hodnota) : hodnota,
            )
          : hodnota,
      ]),
    );
  }

  return upraveny;
}

/** Adresa bez části za otazníkem — ve filtrech bývají jména klientů. */
export function bezParametru(adresa: string): string {
  const konec = adresa.search(/[?#]/);
  return konec === -1 ? adresa : adresa.slice(0, konec);
}

/** Nastavení společné serveru, prohlížeči i okrajovým funkcím. */
export function spolecneNastaveni() {
  return {
    dsn: dsn(),
    enabled: jeZapnute(),
    // Nikdy neposílat IP adresy, hlavičky, cookies ani těla požadavků.
    sendDefaultPii: false,
    tracesSampleRate: VZOREK_MERENI,
    // Ve vývoji by hlášení stejně neodešlo; ať Sentry nepíše do konzole.
    debug: false,
    beforeSend: ocistiUdalost,
    beforeBreadcrumb: ocistiDrobek,
  };
}
