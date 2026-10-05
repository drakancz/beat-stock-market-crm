import { NextResponse, type NextRequest } from "next/server";

import { hlavickaCsp, novyNonce } from "@/lib/csp";

/**
 * Rychlé odbočení nepřihlášeného návštěvníka na přihlašovací obrazovku.
 *
 * **Tohle není bezpečnostní opatření.** Kontroluje se tu jen to, jestli
 * v požadavku vůbec je cookie se sezením — jestli je platná, jestli
 * uživatel pořád existuje a jestli mu nebyl odebrán přístup, se rozhoduje
 * až na serveru v `src/lib/session.ts` a v dotazech do databáze.
 *
 * Smysl je ušetřit zbytečné načítání stránky, na kterou stejně nemá
 * přístup. Kdyby tento soubor někdo smazal, systém zůstane bezpečný —
 * jen se bude nepřihlášeným lidem chvíli ukazovat prázdná obrazovka.
 *
 * V Next.js 16 se tento soubor jmenuje `proxy.ts`; dřívější `middleware.ts`
 * je zastaralý název.
 */

const VEREJNE = ["/prihlaseni", "/zapomenute-heslo", "/nove-heslo"];

/**
 * Jak se jmenuje cookie se sezením v Auth.js.
 *
 * Přes HTTPS má prohlížeč předponu `__Secure-`, přes HTTP ne. Kontrolují
 * se proto obě podoby — jinak by po nasazení na doménu přestalo odbočení
 * fungovat a všichni by končili na přihlašovací obrazovce.
 */
const COOKIE_SEZENI = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Klientská část (`/ucet`, krok 3A, 30. 9. 2026) má vlastní přihlášení
 * a vlastní cookie (`src/lib/klient/sezeni.ts`). Cookie týmu tam nic
 * neotevře a klientova cookie neotevře CRM.
 */
const KLIENTSKA_CAST = "/ucet";
const KLIENT_VEREJNE = [
  "/ucet/prihlaseni",
  "/ucet/zapomenute-heslo",
  "/ucet/nove-heslo",
  "/ucet/zasady",
  "/ucet/podminky",
];
const COOKIE_KLIENTA = ["bsm-klient", "__Host-bsm-klient"];

/**
 * Pustí požadavek dál s Content-Security-Policy (5. 10. 2026, `src/lib/csp.ts`).
 *
 * Klíč ke skriptům (`nonce`) jde do hlavičky **požadavku** — odtud si ho
 * Next.js vezme a doplní na své skripty, kořenový rám ho čte z `x-nonce` —
 * a do hlavičky **odpovědi**, kterou se řídí prohlížeč.
 */
function dalSCsp(request: NextRequest) {
  const nonce = novyNonce();
  const csp = hlavickaCsp({
    nonce,
    vyvoj: process.env.NODE_ENV === "development",
    https: process.env.AUTH_URL?.startsWith("https://") ?? false,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  const hlavicky = new Headers(request.headers);
  hlavicky.set("x-nonce", nonce);
  hlavicky.set("Content-Security-Policy", csp);

  const odpoved = NextResponse.next({ request: { headers: hlavicky } });
  odpoved.headers.set("Content-Security-Policy", csp);
  return odpoved;
}

function zacina(pathname: string, cesty: string[]): boolean {
  return cesty.some((cesta) => pathname === cesta || pathname.startsWith(`${cesta}/`));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (zacina(pathname, [KLIENTSKA_CAST])) {
    const maCookieKlienta = COOKIE_KLIENTA.some((nazev) => request.cookies.has(nazev));
    if (!maCookieKlienta && !zacina(pathname, KLIENT_VEREJNE)) {
      return NextResponse.redirect(new URL("/ucet/prihlaseni", request.url));
    }
    return dalSCsp(request);
  }

  const jeVerejna = VEREJNE.some((cesta) => pathname === cesta || pathname.startsWith(`${cesta}/`));

  const maCookie = COOKIE_SEZENI.some((nazev) => request.cookies.has(nazev));

  if (!maCookie && !jeVerejna) {
    const cil = new URL("/prihlaseni", request.url);
    // Kam se má uživatel vrátit po přihlášení.
    cil.searchParams.set("pokracovat", pathname);
    return NextResponse.redirect(cil);
  }

  /*
   * Opačným směrem — z přihlášení rovnou do aplikace — se tu neodbočuje.
   *
   * Přítomnost cookie totiž neznamená platné sezení: uživatel mohl mezitím
   * skončit v koši nebo mu byl odebrán přístup, a cookie mu v prohlížeči
   * zůstala. Odbočení odsud by ho poslalo do aplikace, server by ho poslal
   * zpátky na přihlášení a prohlížeč by skončil na „příliš mnoho
   * přesměrování". Rozhodnout to umí jen server, který sáhne do databáze —
   * dělá to `src/app/(auth)/prihlaseni/page.tsx`.
   */
  return dalSCsp(request);
}

export const config = {
  /*
   * Řeší se jen skutečné stránky.
   *
   * Vynechané je celé `/_next` — nejen statické soubory, ale i vnitřní
   * cesty Nextu. Kdyby přesměrování dostala i ta, rozbije se načítání
   * aplikace v prohlížeči a stránka zůstane „mrtvá": vykreslí se, ale
   * tlačítka nereagují.
   *
   * Vynechané jsou i ikony, manifesty aplikace a `sw-klient.js` (krok 3A,
   * 4. 10. 2026) — telefon si je stahuje bez přihlášení, při instalaci
   * aplikace na plochu i při příjmu oznámení.
   *
   * Content-Security-Policy s klíčem ke skriptům se proto nastavuje jen
   * na stránkách — vynechané adresy mají obecná pravidla z `next.config.ts`.
   */
  matcher: [
    "/((?!api|_next|favicon.ico|sw-klient\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
