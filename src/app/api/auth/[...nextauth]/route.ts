import { handlers } from "@/lib/auth";
import { adresaVolajiciho, vytvorPocitadloNeuspechu } from "@/lib/verejne-api";

/**
 * Adresy, na kterých běží přihlašování (`/api/auth/...`).
 *
 * Obsluhu poskytuje Auth.js. Sami přidáváme jen omezení pokusů o přihlášení.
 *
 * **Omezení pokusů** (Jakub, 16. 9. 2026): nejvýš 5 **neúspěšných** pokusů
 * za 5 minut z jedné IP adresy, pak `429 Too Many Requests`, a to ještě
 * před ověřením hesla. Úspěšné přihlášení ani krok „zadej kód z telefonu"
 * se nepočítá — kolegové ze stejné kanceláře mají navenek jednu adresu
 * a nesmí se navzájem zablokovat.
 *
 * - **Kdo sem smí:** kdokoli, i nepřihlášený — je to přihlášení.
 * - **Počítadlo je v paměti aplikace**, po restartu se vynuluje. Skutečné
 *   omezení patří do reverzní proxy (security_warnings.md, pravidlo 10).
 * - **Adresa se bere z hlavičky `X-Forwarded-For`, kterou jde podvrhnout.**
 *   Dokud před aplikací není proxy, která hlavičku přepisuje, dá se
 *   omezení obejít. Jakub to 16. 9. 2026 odložil na nasazení.
 * - Na odhlášení, načítání sezení a ostatní adresy Auth.js se omezení
 *   nevztahuje. Přihlášení po nastavení hesla (`nove-heslo/actions.ts`)
 *   sem nechodí vůbec — volá Auth.js přímo na serveru.
 */

const pokusy = vytvorPocitadloNeuspechu({ limit: 5, oknoMs: 5 * 60_000 });

/** Kód chyby, podle kterého formulář ukáže hlášku (`src/lib/auth-errors.ts`). */
const KOD_LIMITU = "prilis_mnoho_pokusu";

/**
 * Jestli Auth.js přihlášení odmítl. Výsledek je v adrese, kam má prohlížeč
 * pokračovat: u formuláře v JSONu (`{ url }`), jinak v přesměrování.
 * Krok `potreba_kod` znamená, že heslo sedělo — neúspěch to není.
 */
async function neuspech(odpoved: Response): Promise<boolean> {
  let adresa: string | null | undefined = odpoved.headers.get("location");

  if (!adresa && odpoved.headers.get("content-type")?.includes("application/json")) {
    const telo: unknown = await odpoved
      .clone()
      .json()
      .catch(() => null);
    if (telo && typeof telo === "object" && "url" in telo && typeof telo.url === "string") {
      adresa = telo.url;
    }
  }

  // Odpověď, které nerozumíme, se počítá jako neúspěch — bezpečnější strana.
  if (!adresa || odpoved.status >= 400) return true;

  try {
    const parametry = new URL(adresa, "http://localhost").searchParams;
    if (!parametry.has("error")) return false;
    return parametry.get("code") !== "potreba_kod";
  } catch {
    return true;
  }
}

export const { GET } = handlers;

export async function POST(request: Request): Promise<Response> {
  if (!new URL(request.url).pathname.endsWith("/callback/credentials")) {
    return handlers.POST(request as Parameters<typeof handlers.POST>[0]);
  }

  const odkud = adresaVolajiciho(request);
  const pokus = pokusy.zaber(odkud);

  if (!pokus.povoleno) {
    // Formulář od Auth.js čte z odpovědi `url` s kódem chyby — bez něj by
    // spadl a místo české hlášky ukázal obecnou.
    const adresa = new URL("/prihlaseni", request.url);
    adresa.searchParams.set("error", "CredentialsSignin");
    adresa.searchParams.set("code", KOD_LIMITU);

    return Response.json(
      { url: adresa.toString() },
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": String(pokus.zaSekund),
        },
      },
    );
  }

  const odpoved = await handlers.POST(request as Parameters<typeof handlers.POST>[0]);

  if (!(await neuspech(odpoved))) pokusy.vrat(odkud);

  return odpoved;
}
