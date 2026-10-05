"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/session";
import { POPIS_CHYBY_SMARTEMAILINGU } from "@/lib/smartemailing";
import { odeberSouhlasOdhlasenym, spustHromadneOdeslani } from "@/lib/smartemailing-synchronizace";

/**
 * SmartEmailing → Synchronizace kontaktů. **Všechno jen administrátor**
 * (Jakub, 13. 9. 2026): hromadné odeslání i načtení odhlášených. Každá
 * akce si `requireAdmin()` volá sama. Chyby a jejich opakování jsou od
 * 15. 9. 2026 v záložce Chyby (`src/app/(app)/smartemailing/chyby`).
 */

export type Vysledek = { ok: true; zprava: string } | { ok: false; chyba: string };

/** Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu. */
function zaloguj(co: string, chyba: unknown) {
  console.error(
    `SmartEmailing: ${co} selhalo:`,
    chyba instanceof Error ? chyba.name : "neznámá chyba",
  );
}

/** Hromadně pošle klienty se souhlasem, kteří ještě neodešli, včetně leadů z webu. */
export async function odesliCekajiciKlienty(): Promise<Vysledek> {
  const admin = await requireAdmin();

  let vysledek;
  try {
    vysledek = await spustHromadneOdeslani(admin.id);
  } catch (chyba) {
    zaloguj("spuštění hromadného odeslání", chyba);
    return { ok: false, chyba: "Odeslání se nepovedlo spustit. Zkus to za chvíli znovu." };
  }

  revalidatePath("/smartemailing");

  switch (vysledek.stav) {
    case "spusteno":
      return {
        ok: true,
        zprava: `Odesílání spuštěno, klientů k odeslání: ${vysledek.pocet}. Přehled se průběžně obnovuje.`,
      };
    case "bezi":
      return { ok: false, chyba: "Hromadné odeslání už běží. Počkej, až doběhne." };
    case "vypnuto":
      return { ok: false, chyba: "Propojení je vypnuté nebo nemá vybraný seznam." };
    case "nic":
      return { ok: true, zprava: "Na odeslání teď nikdo nečeká." };
  }
}

/** Zeptá se SmartEmailingu na odhlášené a těm klientům odebere souhlas. */
export async function nactiOdhlasene(): Promise<Vysledek> {
  const admin = await requireAdmin();

  let vysledek;
  try {
    vysledek = await odeberSouhlasOdhlasenym(admin.id);
  } catch (chyba) {
    zaloguj("načtení odhlášených", chyba);
    return { ok: false, chyba: "Načtení se nepovedlo. Zkus to za chvíli znovu." };
  }

  revalidatePath("/smartemailing");
  revalidatePath("/smartemailing/chyby");
  revalidatePath("/klienti", "layout");

  if (!vysledek.ok) {
    return {
      ok: false,
      chyba:
        vysledek.chyba === "bez-seznamu"
          ? "V Nastavení propojení není vybraný seznam."
          : `${POPIS_CHYBY_SMARTEMAILINGU[vysledek.chyba]}. Chyba je zapsaná v záložce Chyby.`,
    };
  }

  const zpravy: string[] = [];
  if (vysledek.odebrano > 0) {
    zpravy.push(`Souhlas s marketingem odebrán klientům: ${vysledek.odebrano}.`);
  }
  if (vysledek.nedorucitelnych > 0) {
    zpravy.push(
      `Nedoručitelný e-mail u klientů: ${vysledek.nedorucitelnych}. Souhlas jim zůstává, adresu je potřeba opravit.`,
    );
  }
  if (vysledek.odlozenych > 0) {
    zpravy.push(
      `Čerstvě změněných ve SmartEmailingu: ${vysledek.odlozenych}. Ty se vezmou při dalším načtení, nejdřív za 10 minut.`,
    );
  }
  if (zpravy.length === 0) {
    zpravy.push(
      vysledek.odhlasenychVeSmartemailingu === 0
        ? "Ze seznamu se nikdo neodhlásil."
        : `Odhlášených ve SmartEmailingu: ${vysledek.odhlasenychVeSmartemailingu}. Souhlas v CRM už nemá nikdo z nich.`,
    );
  }

  return { ok: true, zprava: zpravy.join(" ") };
}
