import { db } from "@/lib/db";
import { jeUkazka, UKAZKOVY_KLIENT } from "@/lib/ukazka";

/**
 * Karta ukázkového klienta je v ukázce chráněná (Jakub, 22. 10. 2026).
 *
 * Návštěvník přihlášený jako člen týmu by jinak mohl kartu smazat,
 * sloučit, změnit e-mail (přihlašovací jméno) nebo zrušit účet do klientské
 * části — a ostatní návštěvníci by se do ukázky klienta do noční obnovy
 * nedostali. Ostatní karty se mění volně.
 */
export async function jeChranenaKarta(clientId: string): Promise<boolean> {
  if (!jeUkazka()) return false;
  const karta = await db.client.findUnique({ where: { id: clientId }, select: { email: true } });
  return karta?.email?.toLowerCase() === UKAZKOVY_KLIENT.email;
}

export const CHRANENA_KARTA =
  "Kartu ukázkového klienta v ukázce smazat, sloučit ani měnit nejde — přihlašují se přes ni ostatní návštěvníci.";
