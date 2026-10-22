import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { zpracujOznameni, type VysledekOznameni } from "@/lib/platby/platby";

export const metadata: Metadata = { title: "Platba" };

export const dynamic = "force-dynamic";

/**
 * Návrat z platební brány (Jakub souhlasil 19. 10. 2026, `security.md`).
 * **Bez přihlášení** — klient se sem vrací z GoPay. Ukáže jen číslo
 * objednávky a jestli je zaplacená; stav se zjišťuje u GoPay
 * (`zpracujOznameni()`), id z adresy samo nic nezaplatí. Neznámé id
 * k bráně vůbec nejde.
 */
export default async function PlatbaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z
    .string()
    .regex(/^\d{1,30}$/)
    .safeParse((await searchParams).id);

  let vysledek: VysledekOznameni | null = null;
  let vypadek = false;
  if (id.success) {
    try {
      vysledek = await zpracujOznameni(id.data);
    } catch {
      // Výpadek brány nebo sítě — klient uvidí, ať to zkusí znovu.
      vypadek = true;
    }
  }

  return (
    <div className="space-y-4 text-center">
      {vysledek?.zaplaceno ? (
        <>
          <CheckCircle2 className="text-primary mx-auto size-10" aria-hidden />
          <h1 className="text-2xl font-semibold">Děkujeme za platbu</h1>
          <p className="text-muted-foreground">
            Objednávka {vysledek.cislo} je zaplacená. Potvrzení najdete v klientské části.
          </p>
        </>
      ) : (
        <>
          <Clock className="text-muted-foreground mx-auto size-10" aria-hidden />
          <h1 className="text-2xl font-semibold">Platba zatím nedorazila</h1>
          <p className="text-muted-foreground">
            {vypadek
              ? "Stav platby se teď nepodařilo ověřit. Zkuste stránku za chvíli obnovit."
              : vysledek
                ? `Objednávka ${vysledek.cislo} zaplacená není. Zaplatit ji můžete v klientské části.`
                : "Takovou platbu jsme nenašli."}
          </p>
        </>
      )}
      <Button asChild>
        <Link href="/ucet">Do klientské části</Link>
      </Button>
    </div>
  );
}
