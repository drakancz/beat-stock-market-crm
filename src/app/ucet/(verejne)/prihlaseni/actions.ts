"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { prihlasKlienta } from "@/lib/klient/sezeni";
import { overPrihlaseniKlienta, type ChybaPrihlaseni } from "@/lib/klient/ucet";
import { adresaZHlavicek, vytvorPocitadloNeuspechu } from "@/lib/verejne-api";

/**
 * Přihlášení do klientské části. **Dostupné bez přihlášení** — je to samo
 * přihlášení (security.md, tabulka adres bez přihlášení).
 *
 * **Omezení pokusů** stejné jako u týmu: nejvýš 5 **neúspěšných** za
 * 5 minut z jedné adresy. Úspěch ani krok „zadejte kód z telefonu" se
 * nepočítá. Počítadlo je vlastní, oddělené od týmu, a žije v paměti
 * aplikace (po restartu se vynuluje).
 */

const vstup = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  heslo: z.string().min(1).max(128),
  kod: z.string().trim().max(64).optional(),
});

const pokusy = vytvorPocitadloNeuspechu({ limit: 5, oknoMs: 5 * 60_000 });

export type VysledekPrihlaseniKlienta =
  { ok: true } | { ok: false; kod: ChybaPrihlaseni | "prilis_mnoho_pokusu" };

export async function prihlasitKlienta(formData: FormData): Promise<VysledekPrihlaseniKlienta> {
  const kod = String(formData.get("kod") ?? "").trim();
  const data = vstup.safeParse({
    email: formData.get("email"),
    heslo: formData.get("heslo"),
    ...(kod ? { kod } : {}),
  });

  const odkud = adresaZHlavicek(await headers());
  const pokus = pokusy.zaber(odkud);
  if (!pokus.povoleno) return { ok: false, kod: "prilis_mnoho_pokusu" };

  if (!data.success) return { ok: false, kod: "spatne_prihlaseni" };

  const vysledek = await overPrihlaseniKlienta(data.data);

  // „Zadejte kód" znamená, že heslo sedělo — neúspěch to není.
  if (vysledek.ok || vysledek.kod === "potreba_kod") pokusy.vrat(odkud);
  if (!vysledek.ok) return vysledek;

  await prihlasKlienta(vysledek.accountId);
  return { ok: true };
}
