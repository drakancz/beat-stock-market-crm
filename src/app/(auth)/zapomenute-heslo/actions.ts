"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { posliObnovuHesla, posliPozvanku } from "@/lib/email";
import { osloveniUzivatele } from "@/lib/osloveni";
import { vytvorOdkazNaHeslo } from "@/lib/tokeny";
import { adresaZHlavicek, vytvorPocitadlo } from "@/lib/verejne-api";

/**
 * Žádost o odkaz na nové heslo. **Dostupná bez přihlášení** — je to cesta,
 * jak se dostat zpátky do účtu.
 *
 * Odpověď je **vždy stejná**, ať e-mail v systému je, nebo není. Kdyby se
 * lišila, dal by se formulářem projet seznam adres a zjistit, kdo ve firmě
 * pracuje. Proto (bezpečnostní audit, Jakub, 16. 9. 2026):
 *
 * - **Stejná je i doba odpovědi.** Hledání účtu, nový odkaz i e-mail běží
 *   přes `after()`, až po odeslání odpovědi. Dřív se na e-mail čekalo jen
 *   u existujícího účtu a podle rychlosti šlo poznat, kdo v systému je.
 * - **Počet žádostí je omezený** — 5 za 15 minut z jedné IP adresy a
 *   3 za hodinu na jeden e-mail. Jinak by šlo kolegovi zahltit schránku
 *   a každou žádostí mu zrušit čerstvě poslanou pozvánku (nový odkaz ruší
 *   starý). Nad limitem se tiše nic nestane, odpověď je pořád stejná.
 *   Počítadlo je v paměti aplikace, stejně jako u přihlášení.
 */

const vstup = z.string().trim().toLowerCase().min(3).max(254);

const zAdresyPresLimit = vytvorPocitadlo({ limit: 5, oknoMs: 15 * 60_000 });
const naEmailPresLimit = vytvorPocitadlo({ limit: 3, oknoMs: 60 * 60_000 });

export async function pozadejOOdkaz(formData: FormData): Promise<{ ok: true }> {
  const email = vstup.safeParse(formData.get("email"));
  const odkud = adresaZHlavicek(await headers());

  // Obě počítadla se přičtou vždy — i u adresy, kterou systém nezná.
  const adresaPresLimit = zAdresyPresLimit(odkud);
  const emailPresLimit = email.success && naEmailPresLimit(email.data);
  const presLimit = adresaPresLimit || emailPresLimit;

  if (email.success && !presLimit) {
    after(async () => {
      try {
        await posliOdkaz(email.data);
      } catch (chyba) {
        // Jen druh chyby — hlášení z databáze může nést e-mail (pravidlo 8).
        console.error(
          "Odkaz na heslo se nepodařilo připravit:",
          chyba instanceof Error ? chyba.name : "neznámá chyba",
        );
      }
    });
  }

  // Vždy stejná odpověď.
  return { ok: true };
}

/** Najde účet a pošle mu odkaz. Běží až po odeslání odpovědi. */
async function posliOdkaz(email: string): Promise<void> {
  const uzivatel = await db.user.findFirst({
    // Smazaný účet odkaz nedostane — přihlásit by se stejně nemohl.
    where: { email, active: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      firstName: true,
      vocative: true,
      email: true,
      passwordHash: true,
    },
  });
  if (!uzivatel) return;

  const odkaz = await vytvorOdkazNaHeslo(uzivatel.id);
  const osloveni = osloveniUzivatele(uzivatel);

  // Kdo ještě nikdy heslo neměl, dostane pozvánku; ostatním jde obnova.
  // Kontext kvůli sekci Chyby: čí zpráva to je. Nikdo z CRM ji nespustil.
  const kontext = { userId: uzivatel.id, spustilId: null };
  const posta = uzivatel.passwordHash
    ? await posliObnovuHesla({ komu: uzivatel.email, osloveni, odkaz, ...kontext })
    : await posliPozvanku({ komu: uzivatel.email, osloveni, odkaz, ...kontext });

  if (!posta.odeslano && process.env.NODE_ENV !== "production") {
    // Záchranná síť pro vývoj, když odesílání není nastavené. Jen do
    // konzole serveru a záměrně bez jména a e-mailu — do logu osobní
    // údaje nepatří (pravidlo 8).
    console.info(`[vývoj] Odkaz na nastavení hesla pro uživatele ${uzivatel.id}: ${odkaz}`);
  }
}
