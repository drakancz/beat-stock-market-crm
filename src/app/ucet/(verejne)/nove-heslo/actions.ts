"use server";

import { z } from "zod";

import { prihlasKlienta } from "@/lib/klient/sezeni";
import { nastavHesloKlientaTokenem } from "@/lib/klient/ucet";

/**
 * Nastavení hesla z odkazu (pozvánka i zapomenuté heslo). **Dostupné bez
 * přihlášení** — prokazuje se jednorázovým tokenem z odkazu.
 *
 * Po úspěchu se klient rovnou přihlásí, pokud nemá dvoufázové ověření
 * (chyběl by kód z telefonu).
 */

const vstup = z.object({
  token: z.string().trim().min(10).max(200),
  heslo: z.string().min(1).max(128),
});

export type VysledekHeslaKlienta = { ok: true; prihlasen: boolean } | { ok: false; chyba: string };

export async function nastavitHesloKlienta(formData: FormData): Promise<VysledekHeslaKlienta> {
  const data = vstup.safeParse({ token: formData.get("token"), heslo: formData.get("heslo") });
  if (!data.success) return { ok: false, chyba: "Odkaz je neúplný nebo už neplatí." };

  const vysledek = await nastavHesloKlientaTokenem(data.data.token, data.data.heslo);
  if (!vysledek.ok) return vysledek;

  if (vysledek.dvoufazove) return { ok: true, prihlasen: false };

  await prihlasKlienta(vysledek.accountId);
  return { ok: true, prihlasen: true };
}
