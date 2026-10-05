import { requireAdmin } from "@/lib/session";

import { PodmenuNastaveni } from "./podmenu";

/**
 * Celé Nastavení patří administrátorovi — vidět i měnit (Jakub,
 * 10. 9. 2026). Nepřihlášený ani ostatní role se sem nedostanou.
 *
 * Zábrana je schválně tady v rámu, stejně jako u Správy: kdo do Nastavení
 * později přidá další stránku, dostane ochranu automaticky. Jednotlivé
 * obrazovky i serverové akce si `requireAdmin()` volají znovu — rám chrání
 * zobrazení, ale odeslat formulář jde i mimo něj.
 *
 * `requireAdmin()` vrací 404, ne „nemáte oprávnění". Pro nepovolaného tahle
 * část systému prostě neexistuje.
 */
export const dynamic = "force-dynamic";

export default async function NastaveniLayout({ children }: LayoutProps<"/nastaveni">) {
  await requireAdmin();

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Nastavení</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Nastavení pro celou firmu a přehled toho, co kdo v systému dělá. Vidí ho jen
          administrátor.
        </p>
      </div>

      <PodmenuNastaveni />

      {children}
    </>
  );
}
