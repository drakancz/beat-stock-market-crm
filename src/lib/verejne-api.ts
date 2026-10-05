import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Společné pomůcky pro adresy dostupné bez přihlášení — příjem leadů z webu
 * (`POST /api/leady`), odhlášení ze SmartEmailingu
 * (`POST /api/smartemailing/odhlaseni`) a samotné přihlášení
 * (`POST /api/auth/callback/credentials`).
 *
 * Na všech se volající prokazuje tajemstvím, takže tu platí stejná
 * pravidla: porovnání v konstantním čase, omezený počet pokusů a do logu
 * nic z těla požadavku (security_warnings.md, pravidla 3, 8 a 10).
 */

/** Porovnání dvou tajemství, které netrvá různě dlouho podle shody. */
export function stejneTajemstvi(zadane: string, ocekavane: string): boolean {
  // Přes otisky, aby měly obě strany stejnou délku — jinak by se dala
  // uhodnout aspoň délka tajemství.
  const a = createHash("sha256").update(zadane).digest();
  const b = createHash("sha256").update(ocekavane).digest();
  return timingSafeEqual(a, b);
}

/** Odkud požadavek přišel. Za proxy je skutečná adresa v hlavičce. */
export function adresaVolajiciho(request: Request): string {
  return adresaZHlavicek(request.headers);
}

/**
 * Totéž z hlaviček — v serverové akci je dává `headers()` z `next/headers`.
 *
 * **Na Railway** (poznají se podle `RAILWAY_ENVIRONMENT_ID`, kterou tam
 * nastavuje sám Railway) se bere jen `X-Real-IP`: tu jejich okrajová
 * proxy vždy přepíše skutečnou adresou, kdežto u `X-Forwarded-For` se
 * podle jejich fóra dá hodnota od návštěvníka propašovat. S podvrženou
 * adresou by šlo obejít omezení pokusů o přihlášení (19. 9. 2026).
 *
 * Jinde platí `X-Forwarded-For`, kterou musí přepisovat reverzní proxy
 * (CLAUDE.md, Přihlašování). Na ní stojí i testy, které si adresu
 * posílají samy.
 */
export function adresaZHlavicek(hlavicky: Headers): string {
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    return hlavicky.get("x-real-ip")?.trim() || "neznama";
  }

  const forwarded = hlavicky.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || hlavicky.get("x-real-ip") || "neznama";
}

/**
 * Odpověď v JSONu — vždy i s vyznačeným kódováním.
 *
 * Bez `charset=utf-8` si ho někteří klienti domyslí špatně a česká
 * hláška se v terminálu vypíše rozsypaně (PowerShell na Windows).
 */
export function odpovedJson(status: number, telo: Record<string, unknown>): Response {
  return Response.json(telo, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Jednoduché počítadlo požadavků v paměti — kolik jich z jedné adresy
 * projde za okno.
 *
 * Platí jen pro jeden běžící kontejner a po restartu se zapomene — na
 * skutečné omezení patří reverzní proxy. Tady jde o to, aby se tajemství
 * nedalo zkoušet tisíckrát za minutu.
 */
export function vytvorPocitadlo({ limit, oknoMs }: { limit: number; oknoMs: number }) {
  const pocty = new Map<string, { do: number; kolik: number }>();

  /** Započítá požadavek a vrátí, jestli je adresa přes limit. */
  return function pricti(odkud: string): boolean {
    const ted = Date.now();
    const zaznam = pocty.get(odkud);

    if (!zaznam || zaznam.do < ted) {
      pocty.set(odkud, { do: ted + oknoMs, kolik: 1 });

      // Úklid, ať mapa neroste donekonečna při útoku z mnoha adres.
      if (pocty.size > 10_000) {
        for (const [klic, hodnota] of pocty) {
          if (hodnota.do < ted) pocty.delete(klic);
        }
      }

      return false;
    }

    zaznam.kolik += 1;
    return zaznam.kolik > limit;
  };
}

/**
 * Počítadlo **neúspěšných** pokusů z jedné adresy — pro přihlášení, kde
 * se úspěch pozná až z odpovědi.
 *
 * Pokus se započítá **předem** (`zaber`) a úspěšný se pak vrátí (`vrat`).
 * Kdyby se počítalo až po neúspěchu, prošla by dávka souběžných požadavků
 * celá dřív, než se první z nich stihne započítat — ověření hesla trvá
 * desetiny sekundy.
 *
 * Okno běží od prvního pokusu. Požadavky odmítnuté kvůli limitu se už
 * nepřičítají, takže okno se jimi neprodlužuje.
 */
export function vytvorPocitadloNeuspechu({ limit, oknoMs }: { limit: number; oknoMs: number }) {
  const pocty = new Map<string, { do: number; kolik: number }>();

  return {
    /**
     * Zabere místo pro pokus. Když je adresa přes limit, nic nezapočítá
     * a vrátí, za kolik sekund to jde zkusit znovu.
     */
    zaber(odkud: string): { povoleno: true } | { povoleno: false; zaSekund: number } {
      const ted = Date.now();
      const zaznam = pocty.get(odkud);

      if (!zaznam || zaznam.do < ted) {
        pocty.set(odkud, { do: ted + oknoMs, kolik: 1 });

        // Úklid, ať mapa neroste donekonečna při útoku z mnoha adres.
        if (pocty.size > 10_000) {
          for (const [klic, hodnota] of pocty) {
            if (hodnota.do < ted) pocty.delete(klic);
          }
        }

        return { povoleno: true };
      }

      if (zaznam.kolik >= limit) {
        return { povoleno: false, zaSekund: Math.max(1, Math.ceil((zaznam.do - ted) / 1000)) };
      }

      zaznam.kolik += 1;
      return { povoleno: true };
    },

    /** Pokus se povedl — nepočítá se. */
    vrat(odkud: string): void {
      const zaznam = pocty.get(odkud);
      if (!zaznam || zaznam.do < Date.now()) return;

      zaznam.kolik -= 1;
      // Bez neúspěchů se okno zahodí, ať další špatné heslo začne nové
      // a nedědí zbytek okna po úspěšném přihlášení.
      if (zaznam.kolik <= 0) pocty.delete(odkud);
    },
  };
}

/** Nejkratší tajemství, které se přijme — 32 znaků odpovídá výstupu generátoru. */
export const MIN_DELKA_TAJEMSTVI = 32;

/** Začátek zástupných hodnot v `.env.example` — ty jsou veřejně v repozitáři. */
const ZASTUPNA_HODNOTA = "zmen-me";

/**
 * Tajemství z prostředí, jen když se dá použít: je dost dlouhé a není to
 * zástupná hodnota opsaná z `.env.example`. Jinak `null` — adresa, která
 * na něm stojí, pak nepřijme nic (security.md, pravidlo 5).
 */
export function tajemstviZProstredi(nazev: string): string | null {
  const hodnota = process.env[nazev]?.trim();
  if (!hodnota) return null;
  if (hodnota.length < MIN_DELKA_TAJEMSTVI || hodnota.startsWith(ZASTUPNA_HODNOTA)) return null;
  return hodnota;
}
