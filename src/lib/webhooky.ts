import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { after } from "next/server";

import { zapisChybu } from "@/lib/chyby";
import { db } from "@/lib/db";
import { cenaPolozkyBezDph, cenaPolozkySDph } from "@/lib/dph";
import { rozsifruj } from "@/lib/tajemstvi";
import { jeUkazka, VYPNUTO_V_UKAZCE } from "@/lib/ukazka";
import type { UdalostWebhooku } from "@/lib/webhooky-druhy";

/**
 * Odchozí webhooky (Jakub, 19. 10. 2026) — CRM pošle zprávu o události na
 * adresu jiné služby (Zapier, Make…). Nastavuje **jen administrátor**
 * v Nastavení → Webhooky.
 *
 * **Ve zprávách nikdy nejsou e-maily ani telefony** (Jakub vybral „bez
 * kontaktů“, výjimka z pravidla 8 je v `security.md`, oddíl 9). Data se
 * skládají výčtem polí níž — nic se neposílá „celé“.
 *
 * **Adresa jen `https` a ne do vnitřní sítě** (`overAdresu()`): jinak by
 * přes webhook šlo z našeho serveru volat služby, které zvenku vidět
 * nejsou (SSRF). Hlídá se při uložení i před každým odesláním, přesměrování
 * se nenásleduje.
 *
 * **Podpis:** hlavička `X-CRM-Podpis: sha256=<hex>` = HMAC-SHA256 tajemstvím
 * webhooku z textu `<X-CRM-Cas>.<tělo>`. Příjemce si tak ověří, že zpráva
 * je od nás a nikdo ji nezměnil.
 *
 * Odesílá se až po odpovědi (`after()`), pomalá služba nezdrží CRM.
 * Neúspěch se zapíše u webhooku a do Chyb (`webhook.odeslani`);
 * neopakuje se — zpráva by mohla dorazit dvakrát.
 */

const ODESLAT_DO_MS = 10_000;

/**
 * Zkušební adresa jen pro automatické testy — napodobenina služby v kontejneru
 * (`compose.yaml`, služba e2e). Testy na GitHubu běží proti produkčnímu
 * sestavení, proto to nejde podmínit `NODE_ENV`. **Na Railway se nezadává.**
 */
function zkusebniAdresa(): string | null {
  return process.env.WEBHOOKY_ZKUSEBNI_ADRESA || null;
}

/** Adresa IP ze soukromé, místní nebo vyhrazené sítě. */
export function jeVnitrniIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const mala = ip.toLowerCase();
    if (mala === "::1" || mala === "::") return true;
    if (mala.startsWith("::ffff:")) return jeVnitrniIp(mala.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(mala);
  }
  const casti = ip.split(".").map(Number);
  if (casti.length !== 4 || casti.some((c) => !Number.isInteger(c))) return true;
  const [a, b] = casti as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Smí CRM na adresu posílat? Vrací text chyby pro administrátora, nebo
 * `null`. Zkouší i DNS — název, který vede do vnitřní sítě, neprojde.
 */
export async function overAdresu(text: string): Promise<string | null> {
  const zkusebni = zkusebniAdresa();
  if (zkusebni && text.startsWith(zkusebni)) return null;

  let adresa: URL;
  try {
    adresa = new URL(text);
  } catch {
    return "Adresa není platná.";
  }
  if (adresa.protocol !== "https:") return "Adresa musí začínat https://.";
  if (adresa.username || adresa.password) return "Adresa nesmí obsahovat jméno ani heslo.";

  const host = adresa.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return "Adresa vede do vnitřní sítě — tam CRM posílat nebude.";
  }

  try {
    const adresy = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (adresy.length === 0 || adresy.some((a) => jeVnitrniIp(a.address))) {
      return "Adresa vede do vnitřní sítě — tam CRM posílat nebude.";
    }
  } catch {
    return "Takovou adresu se nepodařilo najít.";
  }
  return null;
}

/** Podpis zprávy: HMAC-SHA256 z `<čas>.<tělo>`. */
export function podepis(tajemstvi: string, cas: string, telo: string): string {
  return `sha256=${createHmac("sha256", tajemstvi).update(`${cas}.${telo}`).digest("hex")}`;
}

interface Vysledek {
  ok: boolean;
  status: number | null;
  chyba: string | null;
}

/** Odešle jednu zprávu jednomu webhooku a zapíše výsledek. */
async function dorucit(
  webhook: { id: string; name: string; url: string; secretEncrypted: string },
  udalost: UdalostWebhooku | "zkouska",
  data: Record<string, unknown>,
): Promise<Vysledek> {
  const cas = new Date().toISOString();
  const telo = JSON.stringify({ udalost, cas, data });
  let vysledek: Vysledek;

  // Ukázka nepošle ven nic (src/lib/ukazka.ts); webhook jde založit, ne doručit.
  const zakaz = jeUkazka() ? VYPNUTO_V_UKAZCE : await overAdresu(webhook.url);
  if (zakaz) {
    vysledek = { ok: false, status: null, chyba: zakaz };
  } else {
    try {
      const odpoved = await fetch(webhook.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(ODESLAT_DO_MS),
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "BeatStockMarket-CRM-webhook",
          "X-CRM-Udalost": udalost,
          "X-CRM-Cas": cas,
          "X-CRM-Podpis": podepis(rozsifruj(webhook.secretEncrypted), cas, telo),
        },
        body: telo,
      });
      vysledek = odpoved.ok
        ? { ok: true, status: odpoved.status, chyba: null }
        : { ok: false, status: odpoved.status, chyba: `Služba odpověděla ${odpoved.status}.` };
    } catch (chyba) {
      vysledek = {
        ok: false,
        status: null,
        chyba:
          chyba instanceof Error && chyba.name === "TimeoutError"
            ? "Služba neodpověděla do 10 sekund."
            : "Službu se nepodařilo zastihnout.",
      };
    }
  }

  await db.outgoingWebhook
    .update({
      where: { id: webhook.id },
      data: {
        lastAttemptAt: new Date(),
        lastStatus: vysledek.status,
        lastError: vysledek.chyba,
      },
    })
    .catch(() => undefined);

  if (!vysledek.ok && udalost !== "zkouska" && !jeUkazka()) {
    await zapisChybu({
      druh: "webhook.odeslani",
      kod: vysledek.status ? String(vysledek.status) : "nedoruceno",
      detail: `${webhook.name}: ${vysledek.chyba ?? ""}`,
    });
  }
  return vysledek;
}

/** Zkušební zpráva z Nastavení — výsledek hned, bez zápisu do Chyb. */
export async function vyzkousejWebhook(id: string): Promise<Vysledek | null> {
  const webhook = await db.outgoingWebhook.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, url: true, secretEncrypted: true },
  });
  if (!webhook) return null;
  return dorucit(webhook, "zkouska", { zprava: "Zkušební zpráva z CRM Beat Stock Market." });
}

async function rozesli(udalost: UdalostWebhooku, data: Record<string, unknown>) {
  const webhooky = await db.outgoingWebhook.findMany({
    where: { deletedAt: null, active: true, events: { has: udalost } },
    select: { id: true, name: true, url: true, secretEncrypted: true },
  });
  for (const webhook of webhooky) await dorucit(webhook, udalost, data);
}

/**
 * Pošle zprávu o události všem zapnutým webhookům, které ji odebírají —
 * až po odpovědi. **Nikdy nevyhazuje**: výpadek cizí služby nesmí shodit
 * to, co se v CRM právě stalo. `sestav` skládá data až na pozadí.
 */
export function posliWebhook(
  udalost: UdalostWebhooku,
  sestav: () => Promise<Record<string, unknown> | null>,
): void {
  const prace = async () => {
    try {
      const data = await sestav();
      if (data) await rozesli(udalost, data);
    } catch (chyba) {
      console.error("Webhook selhal:", chyba instanceof Error ? chyba.name : "neznámá chyba");
    }
  };
  try {
    after(prace);
  } catch {
    // Mimo požadavek (skript) `after()` nejde — poslat rovnou.
    void prace();
  }
}

/* ---------- Data událostí — výčtem polí, bez kontaktů ---------- */

const klientVen = (klient: { id: string; name: string }) => ({
  id: klient.id,
  jmeno: klient.name,
});

const naHalere = (castka: number) => Math.round(castka * 100) / 100;

export async function dataObjednavky(orderId: string) {
  const objednavka = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      createdAt: true,
      paidAt: true,
      client: { select: { id: true, name: true } },
      discountCode: { select: { code: true } },
      items: {
        select: {
          quantity: true,
          netPrice: true,
          vatPercent: true,
          product: {
            select: { id: true, name: true, netPrice: true, vatRate: { select: { rate: true } } },
          },
        },
      },
    },
  });
  if (!objednavka) return null;

  const polozky = objednavka.items.map((polozka) => ({
    produktId: polozka.product.id,
    produkt: polozka.product.name,
    kusu: polozka.quantity,
    cenaBezDph: naHalere(cenaPolozkyBezDph(polozka) * polozka.quantity),
    cenaSDph: naHalere(cenaPolozkySDph(polozka) * polozka.quantity),
  }));
  return {
    objednavka: {
      id: objednavka.id,
      cislo: objednavka.number,
      stav: objednavka.status,
      vytvorena: objednavka.createdAt.toISOString(),
      zaplacena: objednavka.paidAt?.toISOString() ?? null,
      mena: objednavka.currency,
      slevovyKod: objednavka.discountCode?.code ?? null,
      celkemBezDph: naHalere(polozky.reduce((s, p) => s + p.cenaBezDph, 0)),
      celkemSDph: naHalere(polozky.reduce((s, p) => s + p.cenaSDph, 0)),
      polozky,
    },
    klient: klientVen(objednavka.client),
  };
}

export async function dataKlienta(clientId: string) {
  const klient = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, createdAt: true, source: { select: { name: true } } },
  });
  if (!klient) return null;
  return {
    klient: {
      ...klientVen(klient),
      zdroj: klient.source.name,
      vytvoren: klient.createdAt.toISOString(),
    },
  };
}

export async function dataRezervace(bookingId: string, puvodniTermin?: Date) {
  const rezervace = await db.consultationBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      client: { select: { id: true, name: true } },
      slot: { select: { startsAt: true, durationMinutes: true } },
    },
  });
  if (!rezervace) return null;
  return {
    rezervace: {
      id: rezervace.id,
      termin: rezervace.slot.startsAt.toISOString(),
      delkaMinut: rezervace.slot.durationMinutes,
      ...(puvodniTermin ? { puvodniTermin: puvodniTermin.toISOString() } : {}),
    },
    klient: klientVen(rezervace.client),
  };
}

export async function dataCertifikatu(certifikatId: string) {
  const certifikat = await db.courseCertificate.findUnique({
    where: { id: certifikatId },
    select: {
      number: true,
      courseId: true,
      courseTitle: true,
      issuedAt: true,
      client: { select: { id: true, name: true } },
    },
  });
  if (!certifikat) return null;
  return {
    kurz: { id: certifikat.courseId, nazev: certifikat.courseTitle },
    certifikat: { cislo: certifikat.number, vydan: certifikat.issuedAt.toISOString() },
    klient: klientVen(certifikat.client),
  };
}
