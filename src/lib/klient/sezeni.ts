import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { db } from "@/lib/db";

/**
 * Přihlášení klienta do klientské části (krok 3A, Jakub, 30. 9. 2026).
 *
 * **Úplně oddělené od přihlášení týmu.** Tým se přihlašuje přes Auth.js
 * (`src/lib/auth.ts`), klient má vlastní cookie a vlastní účet
 * (`client_accounts`). Díky tomu:
 *
 * - klient se do interního CRM nedostane ani omylem — `getViewer()` jeho
 *   cookie vůbec nečte;
 * - člověk z týmu se nedostane do klientské části — `getKlient()` nečte
 *   cookie Auth.js;
 * - v jednom prohlížeči můžou být přihlášení oba zároveň a nepletou se.
 *
 * **Proč ne druhá instance Auth.js:** Auth.js je beta (vědomá výjimka
 * z pravidla o stabilních vydáních) a dvě instance vedle sebe si sdílejí
 * nastavení z prostředí (`AUTH_URL`, cesty, jména cookies). Tady stačí
 * podepsaný záznam „kdo a kdy" — všechno ostatní se stejně ověřuje
 * v databázi při každém požadavku, stejně jako u týmu v `getViewer()`.
 *
 * Záznam v cookie je `base64url(JSON).podpis`, podpis HMAC-SHA256 klíčem
 * odvozeným z `AUTH_SECRET` (s vlastním účelem, ať se klíč nesdílí
 * s ničím jiným). Cookie je `HttpOnly`, `SameSite=Lax` a přes HTTPS
 * `Secure` s předponou `__Host-` (nejde podstrčit ze subdomény).
 */

/** Jak dlouho přihlášení klienta platí. Pak se musí přihlásit znovu. */
export const DELKA_PRIHLASENI_DNU = 7;

/** Jméno cookie. Přes HTTPS s předponou `__Host-`. `proxy.ts` zná obě. */
export const COOKIE_KLIENTA = ["bsm-klient", "__Host-bsm-klient"] as const;

function presHttps(): boolean {
  return (process.env.AUTH_URL ?? "").startsWith("https://");
}

function jmenoCookie(): string {
  return presHttps() ? COOKIE_KLIENTA[1] : COOKIE_KLIENTA[0];
}

function klic(): Buffer {
  const secret = process.env.AUTH_SECRET;
  // Start serveru `AUTH_SECRET` hlídá (`src/instrumentation.ts`); tady je to
  // jen pojistka, ať se nikdy nepodepisuje prázdným klíčem.
  if (!secret) throw new Error("Chybí proměnná AUTH_SECRET.");
  return createHash("sha256").update(`klientska-cast:${secret}`).digest();
}

interface Zaznam {
  /** Id účtu (`client_accounts.id`). */
  u: string;
  /** Kdy bylo přihlášení vydáno (ms). */
  v: number;
}

function podepis(data: string): string {
  return createHmac("sha256", klic()).update(data).digest("base64url");
}

function zakoduj(zaznam: Zaznam): string {
  const data = Buffer.from(JSON.stringify(zaznam)).toString("base64url");
  return `${data}.${podepis(data)}`;
}

function dekoduj(hodnota: string | undefined): Zaznam | null {
  if (!hodnota || hodnota.length > 500) return null;

  const [data, podpis] = hodnota.split(".");
  if (!data || !podpis) return null;

  const ocekavany = Buffer.from(podepis(data));
  const zadany = Buffer.from(podpis);
  if (ocekavany.length !== zadany.length || !timingSafeEqual(ocekavany, zadany)) return null;

  try {
    const zaznam: unknown = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (
      zaznam &&
      typeof zaznam === "object" &&
      "u" in zaznam &&
      "v" in zaznam &&
      typeof zaznam.u === "string" &&
      typeof zaznam.v === "number"
    ) {
      return { u: zaznam.u, v: zaznam.v };
    }
  } catch {
    // Poškozený obsah — jako by cookie nebyla.
  }
  return null;
}

/** Přihlásí klienta: zapíše cookie. Volá se jen po ověření hesla (a kódu). */
export async function prihlasKlienta(accountId: string): Promise<void> {
  const ted = Date.now();
  (await cookies()).set(jmenoCookie(), zakoduj({ u: accountId, v: ted }), {
    httpOnly: true,
    sameSite: "lax",
    secure: presHttps(),
    path: "/",
    maxAge: DELKA_PRIHLASENI_DNU * 24 * 60 * 60,
  });
}

/** Odhlásí klienta v tomhle prohlížeči. */
export async function odhlasKlienta(): Promise<void> {
  const uloziste = await cookies();
  for (const jmeno of COOKIE_KLIENTA) uloziste.delete(jmeno);
}

/** Kdo je přihlášený v klientské části. */
export interface Klient {
  /** Id účtu (`client_accounts.id`). */
  accountId: string;
  /** Id karty klienta (`clients.id`) — podle něj se filtrují všechna data. */
  clientId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
}

/**
 * Přihlášený klient, nebo `null`.
 *
 * Stejně jako `getViewer()` u týmu se **při každém požadavku sahá do
 * databáze**: účet musí existovat, mít heslo a nesmí mít zrušený přístup;
 * karta klienta nesmí být ve Smazaných ani sloučená do jiné. Posunutý
 * `tokensValidFrom` (změna hesla, zrušení přístupu) odhlásí okamžitě.
 */
export const getKlient = cache(async (): Promise<Klient | null> => {
  const uloziste = await cookies();
  const zaznam =
    dekoduj(uloziste.get(COOKIE_KLIENTA[1])?.value) ??
    dekoduj(uloziste.get(COOKIE_KLIENTA[0])?.value);
  if (!zaznam) return null;

  if (zaznam.v + DELKA_PRIHLASENI_DNU * 86_400_000 < Date.now()) return null;

  const ucet = await db.clientAccount.findUnique({
    where: { id: zaznam.u },
    select: {
      id: true,
      passwordHash: true,
      revokedAt: true,
      tokensValidFrom: true,
      twoFactorEnabled: true,
      client: {
        select: { id: true, name: true, email: true, deletedAt: true, mergedIntoId: true },
      },
    },
  });

  if (!ucet || !ucet.passwordHash || ucet.revokedAt) return null;
  if (ucet.client.deletedAt || ucet.client.mergedIntoId) return null;
  if (ucet.tokensValidFrom && ucet.tokensValidFrom.getTime() > zaznam.v) return null;

  // Do Sentry jen vnitřní id a druh účtu, nikdy jméno ani e-mail
  // (stejně jako u týmu, `src/lib/sentry/nastaveni.ts`).
  Sentry.setUser({ id: ucet.client.id, role: "KLIENT" });

  return {
    accountId: ucet.id,
    clientId: ucet.client.id,
    name: ucet.client.name,
    email: ucet.client.email,
    twoFactorEnabled: ucet.twoFactorEnabled,
  };
});

/** Přihlášený klient, jinak přesměrování na přihlášení klientů. */
export async function requireKlient(): Promise<Klient> {
  const klient = await getKlient();
  if (!klient) redirect("/ucet/prihlaseni");
  return klient;
}
