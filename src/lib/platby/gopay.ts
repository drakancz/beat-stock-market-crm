/**
 * Rozhraní platební brány GoPay (REST, Jakub vybral 19. 10. 2026).
 *
 * Klíče jen z prostředí: `GOPAY_GOID`, `GOPAY_CLIENT_ID`,
 * `GOPAY_CLIENT_SECRET`; `GOPAY_URL` je testovací brána
 * (`https://gw.sandbox.gopay.com/api`), dokud se nepřepne na ostrou
 * (`https://gate.gopay.cz/api`). **Bez klíčů je brána vypnutá** a CRM
 * funguje jako dřív (platby se párují ručně).
 *
 * V automatických testech míří `GOPAY_URL` na napodobeninu v kontejneru
 * (`e2e/napodobenina-gopay.mjs`) — ven nic neodchází.
 *
 * **Při zapnutí ostrého účtu ověř tvar požadavků proti aktuální
 * dokumentaci GoPay** (doc.gopay.com) — napodobenina kopíruje to, co tu je.
 */

const VYCHOZI_URL = "https://gw.sandbox.gopay.com/api";
const ODPOVED_DO_MS = 15_000;

interface Nastaveni {
  url: string;
  goid: string;
  clientId: string;
  clientSecret: string;
}

/** Nastavení brány, nebo `null`, když není zapnutá. */
export function nastaveniGoPay(): Nastaveni | null {
  const goid = process.env.GOPAY_GOID?.trim();
  const clientId = process.env.GOPAY_CLIENT_ID?.trim();
  const clientSecret = process.env.GOPAY_CLIENT_SECRET?.trim();
  if (!goid || !clientId || !clientSecret || !/^\d+$/.test(goid)) return null;
  return {
    url: (process.env.GOPAY_URL?.trim() || VYCHOZI_URL).replace(/\/$/, ""),
    goid,
    clientId,
    clientSecret,
  };
}

export class ChybaBrany extends Error {}

/** Přístupový token v paměti procesu, dokud neprojde. */
const tokeny = new Map<string, { token: string; do: number }>();

async function token(nastaveni: Nastaveni, rozsah: "payment-create" | "payment-all") {
  const klic = `${nastaveni.clientId}:${rozsah}`;
  const ulozeny = tokeny.get(klic);
  if (ulozeny && ulozeny.do > Date.now() + 30_000) return ulozeny.token;

  const odpoved = await fetch(`${nastaveni.url}/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(ODPOVED_DO_MS),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${nastaveni.clientId}:${nastaveni.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: rozsah }),
  });
  if (!odpoved.ok) throw new ChybaBrany(`Přihlášení k bráně selhalo (${odpoved.status}).`);
  const data = (await odpoved.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new ChybaBrany("Brána nevrátila přístupový token.");
  tokeny.set(klic, {
    token: data.access_token,
    do: Date.now() + (data.expires_in ?? 1800) * 1000,
  });
  return data.access_token;
}

export interface NovaPlatba {
  cislo: string;
  popis: string;
  /** Celkem s DPH v haléřích. */
  castkaHalere: number;
  mena: string;
  polozky: { nazev: string; castkaHalere: number; kusu: number }[];
  email: string;
  navrat: string;
  oznameni: string;
}

export interface PlatbaUBrany {
  id: string;
  stav: string;
  gwUrl: string | null;
  castkaHalere: number | null;
}

function prectiPlatbu(data: unknown): PlatbaUBrany {
  const platba = data as { id?: number | string; state?: string; gw_url?: string; amount?: number };
  if (platba.id === undefined || !platba.state) {
    throw new ChybaBrany("Brána vrátila neúplnou odpověď.");
  }
  return {
    id: String(platba.id),
    stav: platba.state,
    gwUrl: platba.gw_url ?? null,
    castkaHalere: typeof platba.amount === "number" ? platba.amount : null,
  };
}

/** Založí platbu a vrátí adresu platební stránky. */
export async function zalozPlatbuGoPay(nastaveni: Nastaveni, platba: NovaPlatba) {
  const odpoved = await fetch(`${nastaveni.url}/payments/payment`, {
    method: "POST",
    signal: AbortSignal.timeout(ODPOVED_DO_MS),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token(nastaveni, "payment-create")}`,
    },
    body: JSON.stringify({
      // E-mail plátce GoPay potřebuje kvůli potvrzení platby (zásady: zpracovatel).
      payer: { contact: { email: platba.email } },
      target: { type: "ACCOUNT", goid: Number(nastaveni.goid) },
      amount: platba.castkaHalere,
      currency: platba.mena,
      order_number: platba.cislo,
      order_description: platba.popis,
      items: platba.polozky.map((p) => ({
        type: "ITEM",
        name: p.nazev,
        amount: p.castkaHalere,
        count: p.kusu,
      })),
      callback: { return_url: platba.navrat, notification_url: platba.oznameni },
      lang: "CS",
    }),
  });
  if (!odpoved.ok) throw new ChybaBrany(`Bránu se nepodařilo založit platbu (${odpoved.status}).`);
  return prectiPlatbu(await odpoved.json());
}

/** Aktuální stav platby přímo u brány. */
export async function stavPlatbyGoPay(nastaveni: Nastaveni, id: string) {
  const odpoved = await fetch(`${nastaveni.url}/payments/payment/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(ODPOVED_DO_MS),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${await token(nastaveni, "payment-all")}`,
    },
  });
  if (!odpoved.ok) throw new ChybaBrany(`Stav platby se nepodařilo zjistit (${odpoved.status}).`);
  return prectiPlatbu(await odpoved.json());
}

/** Vrácení peněz (celé částky). */
export async function vratPlatbuGoPay(nastaveni: Nastaveni, id: string, castkaHalere: number) {
  const odpoved = await fetch(
    `${nastaveni.url}/payments/payment/${encodeURIComponent(id)}/refund`,
    {
      method: "POST",
      signal: AbortSignal.timeout(ODPOVED_DO_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${await token(nastaveni, "payment-all")}`,
      },
      body: new URLSearchParams({ amount: String(castkaHalere) }),
    },
  );
  if (!odpoved.ok) throw new ChybaBrany(`Brána vrácení odmítla (${odpoved.status}).`);
  const data = (await odpoved.json()) as { result?: string };
  if (data.result !== "FINISHED" && data.result !== "ACCEPTED") {
    throw new ChybaBrany("Brána vrácení odmítla.");
  }
}
