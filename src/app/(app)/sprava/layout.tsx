import { requireAdmin } from "@/lib/session";

/**
 * Celá sekce Správa patří administrátorovi.
 *
 * Zábrana je schválně tady v rámu, ne v jednotlivých obrazovkách: kdo
 * do Správy později přidá další stránku, dostane ochranu automaticky
 * a nemusí si na ni vzpomenout. Jednotlivé serverové akce si `requireAdmin()`
 * volají znovu — rám chrání zobrazení, ale odeslat formulář jde i mimo něj.
 *
 * `requireAdmin()` vrací 404, ne „nemáte oprávnění". Pro nepovolaného tahle
 * část systému prostě neexistuje.
 */
export const dynamic = "force-dynamic";

export default async function SpravaLayout({ children }: LayoutProps<"/sprava">) {
  await requireAdmin();

  return children;
}
