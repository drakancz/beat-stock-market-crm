import webpush, { WebPushError } from "web-push";

import { db } from "@/lib/db";
import { odesilaniFunguje, posliUpozorneniKlientovi } from "@/lib/email";
import { jeUkazka } from "@/lib/ukazka";

/**
 * Upozornění klientovi (krok 3A, Jakub 4. 10. 2026) — oznámení v telefonu,
 * a když je klient povolená nemá, e-mail.
 *
 * **O čem se klient dozví:** zaplacená objednávka, povolený přístup do
 * programu, blížící se konec členství (týden předem a v den konce) a zpráva
 * od administrátora. Tým oznámení nedostává (Jakub vybral „zatím jen
 * klienti").
 *
 * **Komu:** jen klientovi s aktivním účtem v klientské části — nastavené
 * heslo, nezrušený přístup, karta mimo Smazané a nesloučená. Kdo účet
 * nemá, by odkaz z upozornění stejně neotevřel.
 *
 * **Vypínač v Mém profilu** (`notificationsEnabled`) vypne oznámení
 * i náhradní e-mail. Zprávy od administrátora jsou dál vidět v `/ucet/zpravy`.
 *
 * **Jak oznámení putuje:** server ho zašifruje klíči z prohlížeče klienta
 * a předá doručovací službě prohlížeče (Google, Apple, Mozilla,
 * Microsoft). Ta obsah nepřečte, jen ho doručí. Jiným službám se nic
 * neposílá — adresu zařízení hlídá `jePovolenaAdresa()`. Text se ukáže
 * na zamčené obrazovce, proto **bez částek a názvů produktů**.
 *
 * **Nikdy nic nevyhazuje** — upozornění nesmí shodit přepnutí stavu
 * objednávky ani nic jiného. Do logu jde jen druh chyby (pravidlo 8).
 */

/* ---------- Klíče VAPID ---------- */

/**
 * Klíče, kterými se server prokazuje doručovacím službám. Veřejný jde do
 * prohlížeče (bez něj se zařízení nepřihlásí), soukromý je tajemství
 * (security.md, pravidlo 5). Bez nich se oznámení neposílají — zůstává
 * náhradní e-mail. V testech chybí schválně, testy běží bez služeb mimo
 * počítač.
 */
interface KlicePush {
  verejny: string;
  soukromy: string;
}

function klicePush(): KlicePush | null {
  // Ukázka nepošle ven nic (src/lib/ukazka.ts) — oznámení jsou jako nenastavená.
  if (jeUkazka()) return null;
  const verejny = process.env.VAPID_PUBLIC_KEY?.trim();
  const soukromy = process.env.VAPID_PRIVATE_KEY?.trim();
  // Veřejný klíč P-256 má v base64url 87 znaků, soukromý 43.
  if (!verejny || !soukromy) return null;
  if (!/^[A-Za-z0-9_-]{87}$/.test(verejny) || !/^[A-Za-z0-9_-]{43}$/.test(soukromy)) {
    return null;
  }
  return { verejny, soukromy };
}

/** Veřejný klíč pro prohlížeč, nebo `null`, když oznámení na serveru nejsou. */
export function verejnyKlicPush(): string | null {
  return klicePush()?.verejny ?? null;
}

/**
 * Kontakt pro doručovací služby (povinná součást VAPID). Adresa aplikace
 * stačí; přes `http://localhost` ji služby neberou, ve vývoji proto
 * obecná schránka.
 */
function kontaktProSluzby(): string {
  const adresa = process.env.AUTH_URL ?? "";
  return adresa.startsWith("https://") ? adresa : "mailto:oznameni@localhost.invalid";
}

/* ---------- Zařízení ---------- */

/**
 * Doručovací služby prohlížečů. **Jiné adresy server odmítne** — jinak by
 * šlo prohlížečem podstrčit libovolnou adresu a server by na ni posílal
 * požadavky (SSRF).
 */
const SLUZBY = [
  "fcm.googleapis.com", // Chrome, Edge na Androidu, Samsung, Opera
  "android.googleapis.com",
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari, iPhone
];

export function jePovolenaAdresa(endpoint: string): boolean {
  let adresa: URL;
  try {
    adresa = new URL(endpoint);
  } catch {
    return false;
  }
  if (adresa.protocol !== "https:" || adresa.port !== "" || adresa.username || adresa.password) {
    return false;
  }
  const host = adresa.hostname.toLowerCase();
  // Edge ve Windows posílá přes Microsoft (`*.notify.windows.com`).
  return SLUZBY.includes(host) || host.endsWith(".notify.windows.com");
}

/** Kolik zařízení si jeden klient může povolit. Nejstarší nad limit se zapomene. */
export const MAX_ZARIZENI = 10;

/** Krátký popis zařízení pro klienta („iPhone · Safari"), nic víc z hlavičky. */
export function popisZarizeni(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "zařízení";
  const prohlizec = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "prohlížeč";
  return `${system} · ${prohlizec}`;
}

/* ---------- Odeslání ---------- */

/** Co klient dostane. Text oznámení je krátký, e-mail smí říct víc. */
export interface Upozorneni {
  /** Nadpis oznámení i předmět e-mailu. */
  nadpis: string;
  /** Text oznámení — **bez částek a názvů produktů** (zamčená obrazovka). */
  text: string;
  /** Kam oznámení vede — vždy stránka klientské části. */
  odkaz: `/ucet${string}`;
  /** Druh kvůli seskupení na telefonu: další oznámení téhož druhu nahradí předchozí. */
  znacka: string;
  /** Odstavce e-mailu. Když chybí, použije se `text`. */
  odstavceEmailu?: string[];
}

/**
 * Jak se upozornění doručilo. `BEZ_UCTU` = klient účet do klientské části
 * nemá (nebo zrušený) a nedostal nic.
 */
export type Doruceni = "OZNAMENI" | "EMAIL" | "JEN_UCET" | "BEZ_UCTU";

/** Nejdelší text v oznámení. Celá zpráva je v klientské části. */
const MAX_TEXT_OZNAMENI = 240;

function zkrat(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Pošle oznámení na všechna zařízení účtu. Vrátí, na kolik dorazilo. */
async function posliNaZarizeni(accountId: string, upozorneni: Upozorneni): Promise<number> {
  const klice = klicePush();
  if (!klice) return 0;

  const zarizeni = await db.clientPushSubscription.findMany({
    where: { accountId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  const obsah = JSON.stringify({
    title: upozorneni.nadpis,
    body: zkrat(upozorneni.text, MAX_TEXT_OZNAMENI),
    url: upozorneni.odkaz,
    tag: upozorneni.znacka,
  });

  let dorazilo = 0;
  for (const z of zarizeni) {
    // Pojistka i pro starší řádky — adresa mimo doručovací služby se nepoužije.
    if (!jePovolenaAdresa(z.endpoint)) {
      await db.clientPushSubscription.delete({ where: { id: z.id } }).catch(() => {});
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: z.endpoint, keys: { p256dh: z.p256dh, auth: z.auth } },
        obsah,
        {
          vapidDetails: {
            subject: kontaktProSluzby(),
            publicKey: klice.verejny,
            privateKey: klice.soukromy,
          },
          // Den — oznámení, které do té doby nedorazí (vypnutý telefon),
          // už nemá smysl; klient to stejně uvidí v klientské části.
          TTL: 24 * 60 * 60,
          timeout: 10_000,
        },
      );
      dorazilo += 1;
      await db.clientPushSubscription
        .update({ where: { id: z.id }, data: { lastSuccessAt: new Date() } })
        .catch(() => {});
    } catch (chyba) {
      // 404 a 410 = klient oznámení v prohlížeči zrušil nebo aplikaci
      // odinstaloval. Zařízení se zapomene, příště se nezkouší.
      if (chyba instanceof WebPushError && (chyba.statusCode === 404 || chyba.statusCode === 410)) {
        await db.clientPushSubscription.delete({ where: { id: z.id } }).catch(() => {});
        continue;
      }
      const kod = chyba instanceof WebPushError ? String(chyba.statusCode) : "";
      console.error(
        `Oznámení klientovi neodešlo (${chyba instanceof Error ? chyba.name : "neznámá chyba"} ${kod}).`,
      );
    }
  }
  return dorazilo;
}

/**
 * Upozorní klienta: oznámením na jeho zařízení, a když nedorazí na žádné,
 * e-mailem. Vrátí, jak se to povedlo.
 *
 * E-mail se zkouší jen tehdy, když na serveru e-maily fungují — na
 * serveru zatím není Amazon SES a každé upozornění by jinak zakládalo
 * chybu v sekci Chyby. Klient upozornění tak jako tak uvidí v klientské
 * části (zprávy v Zprávách, platby a členství v přehledu).
 */
export async function upozorniKlienta(clientId: string, upozorneni: Upozorneni): Promise<Doruceni> {
  try {
    const ucet = await db.clientAccount.findFirst({
      where: {
        clientId,
        passwordHash: { not: null },
        revokedAt: null,
        client: { deletedAt: null, mergedIntoId: null },
      },
      select: { id: true, notificationsEnabled: true, client: { select: { email: true } } },
    });
    if (!ucet) return "BEZ_UCTU";
    if (!ucet.notificationsEnabled) return "JEN_UCET";

    if ((await posliNaZarizeni(ucet.id, upozorneni)) > 0) return "OZNAMENI";

    if (!odesilaniFunguje()) return "JEN_UCET";
    const posta = await posliUpozorneniKlientovi({
      komu: ucet.client.email,
      clientId,
      predmet: upozorneni.nadpis,
      odstavce: upozorneni.odstavceEmailu ?? [upozorneni.text],
      odkaz: upozorneni.odkaz,
    });
    return posta.odeslano ? "EMAIL" : "JEN_UCET";
  } catch (chyba) {
    console.error(
      "Upozornění klientovi selhalo:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
    return "JEN_UCET";
  }
}

/* ---------- Jednotlivá upozornění ---------- */

/** Objednávka se přepnula na Zaplaceno (ručně nebo rovnou z Landing Page). */
export async function upozorniNaZaplaceni(orderId: string): Promise<void> {
  const objednavka = await db.order
    .findFirst({
      where: { id: orderId, deletedAt: null, status: "ZAPLACENO" },
      select: {
        number: true,
        clientId: true,
        faktury: { where: { kind: "FAKTURA" }, select: { number: true } },
      },
    })
    .catch(() => null);
  if (!objednavka) return;
  // Faktura (19. 10. 2026) vzniká těsně před tímhle upozorněním.
  const faktura = objednavka.faktury[0]?.number;

  await upozorniKlienta(objednavka.clientId, {
    nadpis: "Objednávka je zaplacená",
    text: `Děkujeme, objednávku ${objednavka.number} máme zaplacenou.`,
    odkaz: "/ucet",
    znacka: `objednavka-${objednavka.number}`,
    odstavceEmailu: [
      `Dobrý den, děkujeme — objednávku ${objednavka.number} máme zaplacenou.`,
      faktura
        ? `Fakturu  i to, do kdy vám platí členství, najdete v klientské části.`
        : "Co jste objednali a do kdy vám platí členství, najdete v klientské části.",
    ],
  });
}

/** Administrátor klientovi povolil přístup do programu. */
export async function upozorniNaPristup(clientId: string): Promise<void> {
  await upozorniKlienta(clientId, {
    nadpis: "Přístup do programu je povolený",
    text: "Máte povolený přístup do programu.",
    odkaz: "/ucet",
    znacka: "pristup",
    odstavceEmailu: [
      "Dobrý den, právě jsme vám povolili přístup do programu.",
      "Stav přístupu a svoje členství najdete v klientské části.",
    ],
  });
}

/**
 * Zkušební oznámení z Mého profilu — klient si ověří, že mu oznámení
 * chodí. Jde jen na jeho zařízení, e-mailem nikdy. Vrátí počet zařízení,
 * kam dorazilo.
 */
export async function posliZkusebniOznameni(accountId: string): Promise<number> {
  try {
    return await posliNaZarizeni(accountId, {
      nadpis: "Oznámení fungují",
      text: "Takhle vám budou chodit upozornění z klientské části Beat Stock Market.",
      odkaz: "/ucet/profil",
      znacka: "zkouska",
    });
  } catch {
    return 0;
  }
}
