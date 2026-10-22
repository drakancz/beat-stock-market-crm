/**
 * Kontrola hlavičky `Origin` u požadavků, které mění data nebo vydávají
 * soubor (nahrání přílohy, hromadný export klientů).
 *
 * **Porovnává se s `AUTH_URL`, ne s `request.url`** (17. 10. 2026). Produkční
 * server (standalone) skládá `request.url` z adresy, na které poslouchá
 * (`HOSTNAME=0.0.0.0`), ne z toho, kam prohlížeč posílal — `Origin`
 * `https://…railway.app` se pak nikdy neshodoval s `http://0.0.0.0:8080`
 * a každý takový požadavek skončil 403. Ve vývoji (`next dev`) se to
 * neprojevilo; přišlo se na to testy proti produkčnímu sestavení.
 *
 * `AUTH_URL` je veřejná adresa aplikace — z ní se skládají i odkazy
 * v e-mailech. Bez ní se porovná s `request.url` jako dřív.
 */
export function jeCiziPuvod(request: Request): boolean {
  const puvod = request.headers.get("origin");
  // Bez hlavičky (starší prohlížeč, požadavek z téže stránky bez `Origin`)
  // rozhodují ostatní zábrany — cookie `SameSite=Lax` a přihlášení.
  if (!puvod) return false;
  return puvod !== nasPuvod(request);
}

function nasPuvod(request: Request): string {
  const zNastaveni = process.env.AUTH_URL;
  if (zNastaveni) {
    try {
      return new URL(zNastaveni).origin;
    } catch {
      // Neplatná AUTH_URL — aplikace by stejně neposílala platné odkazy.
    }
  }
  return new URL(request.url).origin;
}
