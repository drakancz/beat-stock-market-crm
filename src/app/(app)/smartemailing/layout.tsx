import { requireAdmin } from "@/lib/session";

import { PodmenuSmartemailingu } from "./podmenu";

/**
 * Sekce SmartEmailing — **jen administrátor, vidět i používat** (Jakub,
 * 13. 9. 2026). Nepřihlášený ani ostatní role se sem nedostanou.
 *
 * Zábrana je v rámu stejně jako u Nastavení a Správy: stránka, která do
 * sekce přibude později, dostane ochranu automaticky. Obrazovky i serverové
 * akce si `requireAdmin()` volají znovu — rám chrání zobrazení, ale
 * formulář jde odeslat i mimo něj. Nepovolaný dostane 404.
 */
export const dynamic = "force-dynamic";

export default async function SmartemailingLayout({ children }: LayoutProps<"/smartemailing">) {
  await requireAdmin();

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">SmartEmailing</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Odesílání klientů se souhlasem do SmartEmailingu, chyby, odhlášení a nastavení propojení.
          Vidí ho jen administrátor.
        </p>
      </div>

      <PodmenuSmartemailingu />

      {children}
    </>
  );
}
