import { requireViewer } from "@/lib/session";

import { PodmenuVzdelavani } from "./podmenu";

/**
 * Sekce Vzdělávání (krok 3C, Jakub 4. 10. 2026): kurzy a lekce, členská
 * sekce a webináře pro klienty.
 *
 * **Vidí každý přihlášený, mění jen administrátor.** Tlačítka pro úpravy
 * se ukazují jen administrátorovi, ale ochrana je v serverových akcích
 * (`requireAdmin()`), ne ve skrytém tlačítku.
 */
export const dynamic = "force-dynamic";

export default async function VzdelavaniLayout({ children }: LayoutProps<"/vzdelavani">) {
  await requireViewer();

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Vzdělávání</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Obsah pro klienty v klientské části: kurzy, členská sekce a termíny webinářů. Upravuje ho
          administrátor.
        </p>
      </div>

      <PodmenuVzdelavani />

      {children}
    </>
  );
}
