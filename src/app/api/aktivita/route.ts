import { z } from "zod";

import { zapisUdalostPozdeji } from "@/lib/aktivita";
import { db } from "@/lib/db";
import { viditelniKlienti } from "@/lib/queries";
import { getViewer } from "@/lib/session";

/**
 * Záznam otevřené obrazovky do Aktivity.
 *
 * Posílá ho `ZaznamObrazovek` z prohlížeče při každé změně adresy. Rám
 * aplikace se při přechodu mezi stránkami na serveru znovu nevykresluje,
 * takže se to na serveru samo poznat nedá.
 *
 * Vlastní adresa, ne serverová akce: akce běží jedna po druhé a záznam by
 * zdržoval ukládání formulářů. Tahle adresa jen zapíše řádek a vrátí
 * prázdnou odpověď; zápis proběhne až po ní.
 *
 * **Co přijde z prohlížeče, je vstup od uživatele** (security_warnings.md,
 * pravidlo 11): přijme se jen adresa rozumné délky ze znaků, které
 * v adresách aplikace jsou, a karta klienta se zapíše s vazbou jen tehdy,
 * když ji ten člověk smí vidět. Pokus otevřít cizí kartu tak v záznamu
 * zůstane jako adresa — i to je pro administrátora užitečné.
 */

/** Adresa bez části za otazníkem — v hledání bývají jména a telefony klientů. */
const ADRESA = /^\/[A-Za-z0-9\-_/.~]{0,199}$/;

const KARTA_KLIENTA = /^\/klienti\/([A-Za-z0-9_-]{1,64})$/;

const telo = z.object({ path: z.string().regex(ADRESA) });

const odpoved = (status: number) => new Response(null, { status });

export async function POST(request: Request) {
  // Jen z naší vlastní stránky. Prohlížeč tuhle hlavičku stránce podvrhnout
  // nedovolí; starší prohlížeče ji neposílají, ty pak chrání cookie se
  // sezením, která se na cizí weby neposílá.
  const odkud = request.headers.get("sec-fetch-site");
  if (odkud && odkud !== "same-origin") return odpoved(403);

  const viewer = await getViewer();
  if (!viewer) return odpoved(401);

  const text = await request.text();
  if (text.length > 1000) return odpoved(413);

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return odpoved(400);
  }

  const vstup = telo.safeParse(data);
  if (!vstup.success) return odpoved(400);

  const { path } = vstup.data;

  let clientId: string | undefined;
  const karta = KARTA_KLIENTA.exec(path);
  if (karta) {
    const klient = await db.client.findFirst({
      where: { AND: [viditelniKlienti(viewer), { id: karta[1] }] },
      select: { id: true },
    });
    clientId = klient?.id;
  }

  zapisUdalostPozdeji({ userId: viewer.id, kind: "ZOBRAZENI", path, clientId });

  return odpoved(204);
}
