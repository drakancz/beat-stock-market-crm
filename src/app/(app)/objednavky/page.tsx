import type { Metadata } from "next";
import { ReceiptText, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { filtrujiSeObjednavky, prectiFiltrObjednavek } from "@/lib/filtry";
import { formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { nactiKlientyProVyber, nactiObjednavky, nactiRokyObjednavek } from "@/lib/queries";
import { requireViewer } from "@/lib/session";

import { FiltryObjednavek } from "./filtry-objednavek";
import { SeznamObjednavek } from "./seznam-objednavek";
import { MENA_CENIKU } from "../produkty/nabidka";

export const metadata: Metadata = { title: "Objednávky" };

export const dynamic = "force-dynamic";

/**
 * Objednávky — co si klienti koupili.
 *
 * **Vidí je každý přihlášený** (Jakub, 22. 9. 2026) — klienti se nikomu
 * nepřiřazují. Rozsah je pořád v dotazu (`viditelneObjednavky()`
 * v `src/lib/queries.ts`), ne ve výpisu.
 *
 * **Stav a přístup do programu přepíná jen administrátor**
 * (Jakub, 22. 9. 2026). Poznámku a smazání má každý, kdo objednávku vidí.
 *
 * **Zakládat objednávky v CRM nejde.** Vytvoří je klient na Landing Page
 * a CRM je převezme přes `POST /api/objednavky`. Proto tu není tlačítko
 * „Nová objednávka" ani kanban s přetahováním — o stavu rozhoduje platba,
 * ne obchodník.
 */
export default async function ObjednavkyPage({ searchParams }: PageProps<"/objednavky">) {
  const viewer = await requireViewer();

  const parametry = await searchParams;
  const filtr = prectiFiltrObjednavek(parametry);

  const [objednavky, klienti, roky] = await Promise.all([
    nactiObjednavky(viewer, filtr),
    nactiKlientyProVyber(viewer),
    nactiRokyObjednavek(viewer),
  ]);

  const jeAdmin = viewer.role === "ADMINISTRATOR";

  // Ceník je celý v korunách, takže se sčítá jediná měna. Hlavní číslo je
  // bez DPH; s daní se ukazuje vedle jako doplňující údaj.
  const mena = objednavky[0]?.currency ?? MENA_CENIKU;
  const celkem = objednavky.reduce((soucet, objednavka) => soucet + objednavka.hodnota, 0);
  const celkemSDph = objednavky.reduce((soucet, objednavka) => soucet + objednavka.hodnotaSDph, 0);

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Objednávky</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Co si klienti koupili. Objednávky chodí z Landing Page; stav platby přepíná administrátor.
          Přístup do programu je od 23. 9. 2026 u klienta, v sekci Klienti.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <FiltryObjednavek klienti={klienti} roky={roky} />

          {objednavky.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {pocet(objednavky.length, "objednávka", "objednávky", "objednávek")} v celkové ceně{" "}
              <span className="tabular text-foreground font-medium">
                {formatMoney(celkem, mena)}
              </span>{" "}
              bez DPH, s DPH <span className="tabular">{formatMoney(celkemSDph, mena)}</span>.
            </p>
          )}

          {objednavky.length === 0 && filtrujiSeObjednavky(filtr) ? (
            <EmptyState
              icon={SearchX}
              title="Žádná objednávka neodpovídá zadání."
              description="Zkus jiný název nebo zruš filtry."
            />
          ) : objednavky.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="Zatím tu není žádná objednávka."
              description="Objednávky zakládají klienti sami na Landing Page. V CRM se zapisovat nedají — až Landing Page vznikne, objeví se tu samy."
            />
          ) : (
            <SeznamObjednavek objednavky={objednavky} jeAdmin={jeAdmin} />
          )}
        </CardContent>
      </Card>
      {/* Rámeček „Objednávka není portfolio" pod tabulkou Jakub 24. 9. 2026 zrušil. */}
    </>
  );
}
