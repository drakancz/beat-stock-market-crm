"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import { posliObnovuHeslaKlientovi, posliPozvankuKlientovi } from "@/lib/email";
import { najdiUcetPodleEmailu, vytvorOdkazKlienta } from "@/lib/klient/ucet";
import { adresaZHlavicek, vytvorPocitadlo } from "@/lib/verejne-api";

/**
 * Zapomenuté heslo do klientské části. **Dostupné bez přihlášení.**
 *
 * Stejná pravidla jako u týmu (`(auth)/zapomenute-heslo/actions.ts`):
 * odpověď je vždy stejná a stejně rychlá (všechno běží přes `after()`),
 * nejvýš 5 žádostí za 15 minut z adresy a 3 za hodinu na e-mail.
 * Klientovi se zrušeným přístupem ani smazanému klientovi nic nepřijde.
 */

const vstup = z.string().trim().toLowerCase().min(3).max(254);

const zAdresyPresLimit = vytvorPocitadlo({ limit: 5, oknoMs: 15 * 60_000 });
const naEmailPresLimit = vytvorPocitadlo({ limit: 3, oknoMs: 60 * 60_000 });

export async function pozadatOOdkazKlienta(formData: FormData): Promise<{ ok: true }> {
  const email = vstup.safeParse(formData.get("email"));
  const odkud = adresaZHlavicek(await headers());

  // Obě počítadla se přičtou vždy — i u adresy, kterou systém nezná.
  const adresaPresLimit = zAdresyPresLimit(odkud);
  const emailPresLimit = email.success && naEmailPresLimit(email.data);

  if (email.success && !adresaPresLimit && !emailPresLimit) {
    after(async () => {
      try {
        await posliOdkaz(email.data);
      } catch (chyba) {
        console.error(
          "Odkaz na heslo klienta se nepodařilo připravit:",
          chyba instanceof Error ? chyba.name : "neznámá chyba",
        );
      }
    });
  }

  return { ok: true };
}

async function posliOdkaz(email: string): Promise<void> {
  const ucet = await najdiUcetPodleEmailu(email);
  if (!ucet) return;

  const odkaz = await vytvorOdkazKlienta(ucet.id);
  // Kdo si heslo ještě nenastavil, dostane znovu pozvánku.
  const posta = ucet.passwordHash
    ? await posliObnovuHeslaKlientovi({ komu: ucet.client.email, odkaz, clientId: ucet.client.id })
    : await posliPozvankuKlientovi({
        komu: ucet.client.email,
        odkaz,
        clientId: ucet.client.id,
        spustilId: null,
      });

  if (!posta.odeslano && process.env.NODE_ENV !== "production") {
    // Jen ve vývoji a bez jména a e-mailu (pravidlo 8).
    console.info(`[vývoj] Odkaz na heslo klienta ${ucet.client.id}: ${odkaz}`);
  }
}
