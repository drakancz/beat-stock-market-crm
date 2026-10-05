import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { dvoufazovePovinne, nactiNastaveni } from "@/lib/nastaveni";
import { osloveniUzivatele } from "@/lib/osloveni";
import type { Role } from "@/generated/prisma/enums";

/**
 * Kdo se dívá.
 *
 * Tohle je jediné místo, odkud se v celé aplikaci bere přihlášený uživatel.
 * Role se pak předává do dotazů do databáze (`src/lib/queries.ts`) — nikdy
 * se nespoléhá na to, co přišlo z prohlížeče (security_warnings.md,
 * pravidlo 5).
 *
 * **Proč se sahá do databáze, když je uživatel v tokenu:** Auth.js drží
 * sezení v podepsaném tokenu v prohlížeči. Token si nese roli a jméno
 * z okamžiku přihlášení a sám od sebe se nezmění. Kdyby se věřilo jen
 * jemu, odcházející kolega by měl přístup ještě dvanáct hodin a povýšení
 * na manažera by se projevilo až po odhlášení. Proto se při každém
 * požadavku ověří, že účet pořád existuje, má přístup a nebyla mu
 * mezitím zneplatněna přihlášení.
 *
 * Tady se vynucuje i **délka přihlášení z Nastavení** a **povinné
 * dvoufázové ověření** (Jakub, 10. 9. 2026).
 *
 * Dotaz je obalený v `cache()`, takže na jedno vykreslení stránky
 * proběhne jednou, i když se `requireViewer()` volá na několika místech.
 */
export interface Viewer {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Oslovení v 5. pádu z profilu, jinak návrh z křestního jména. */
  osloveni: string;
  /**
   * Administrátor mu nastavil povinné dvoufázové ověření a on ho ještě
   * nemá zapnuté. Dokud to tak je, dostane se jen na Můj profil.
   */
  chybiDvoufazove: boolean;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  const id = session?.user?.id;

  if (!id) return null;

  const [uzivatel, nastaveni] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        deletedAt: true,
        tokensValidFrom: true,
        twoFactorEnabled: true,
        firstName: true,
        vocative: true,
      },
    }),
    nactiNastaveni(),
  ]);

  // Účet v koši se chová jako neexistující — do systému se nedostane
  // ani s platným tokenem v prohlížeči.
  if (!uzivatel || !uzivatel.active || uzivatel.deletedAt) return null;

  // Přihlášení vydaná před tímhle časem už neplatí — používá se při
  // odebrání přístupu a při změně hesla.
  const vydano = session.user.vydano ?? 0;
  if (uzivatel.tokensValidFrom && uzivatel.tokensValidFrom.getTime() > vydano) return null;

  // Délka přihlášení z Nastavení. Token sám platí nejvýš 24 hodin
  // (`maxAge` v `src/lib/auth.ts`); kratší lhůta se hlídá tady.
  if (vydano + nastaveni.sessionHours * 3_600_000 < Date.now()) return null;

  // Kdo byl přihlášený, kdyby při zpracování požadavku spadla chyba.
  // Ven jde jen vnitřní ID a role, nikdy jméno ani e-mail (Jakub,
  // 17. 9. 2026) — viz `src/lib/sentry/nastaveni.ts`.
  Sentry.setUser({ id: uzivatel.id, role: uzivatel.role });

  return sestavViewer(uzivatel, nastaveni);
});

/** Co z účtu potřebuje `sestavViewer()`. */
export interface UcetProViewer {
  id: string;
  name: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  firstName: string;
  vocative: string | null;
}

/**
 * Viewer z ověřeného účtu.
 *
 * Sdílí ho přihlášení v prohlížeči (`getViewer()`) i klíč pro MCP
 * (`src/lib/mcp/klice.ts`), aby obě cesty dostaly stejná pravidla —
 * hlavně povinné dvoufázové ověření. Kontroly přístupu a smazání si
 * volající dělá sám, dřív než sem účet pošle.
 */
export function sestavViewer(
  uzivatel: UcetProViewer,
  nastaveni: Awaited<ReturnType<typeof nactiNastaveni>>,
): Viewer {
  return {
    id: uzivatel.id,
    name: uzivatel.name,
    email: uzivatel.email,
    role: uzivatel.role,
    osloveni: osloveniUzivatele(uzivatel),
    chybiDvoufazove:
      dvoufazovePovinne(nastaveni.twoFactorPolicy, uzivatel.role) && !uzivatel.twoFactorEnabled,
  };
}

/**
 * Přihlášený uživatel, jinak přesměrování na přihlášení.
 *
 * Kdo má povinné dvoufázové ověření a nemá ho zapnuté, skončí na Mém účtu
 * (Jakub, 10. 9. 2026). Výjimku `bezDvoufazoveho` má jen rám aplikace
 * a samotný Můj účet s jeho akcemi — jinak by si ověření neměl kde zapnout.
 */
export async function requireViewer(moznosti?: { bezDvoufazoveho?: boolean }): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/prihlaseni");
  if (viewer.chybiDvoufazove && !moznosti?.bezDvoufazoveho) redirect("/profil?dvoufazove=povinne");
  return viewer;
}

/**
 * Přihlášený administrátor, jinak 404.
 *
 * Používá se na serveru u každé obrazovky i akce, která mění uživatele.
 * Schování odkazu v menu není bezpečnostní opatření — kdo zná adresu,
 * dostal by se tam i bez něj.
 *
 * Záměrně 404 a ne 403: stránka pro nepovolaného vůbec neexistuje, takže
 * se z odpovědi nedá vyčíst, co všechno v systému je. Stejně se chová
 * i karta cizího klienta.
 */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "ADMINISTRATOR") notFound();
  return viewer;
}
