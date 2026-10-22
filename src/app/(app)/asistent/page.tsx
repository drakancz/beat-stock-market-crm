import type { Metadata } from "next";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { asistentZapnuty, DENNI_LIMIT, zbyvaOtazek } from "@/lib/asistent/asistent";
import { requireAdmin } from "@/lib/session";
import { jeUkazka } from "@/lib/ukazka";

import { Rozhovor } from "./rozhovor";

export const metadata: Metadata = { title: "Asistent AI" };

export const dynamic = "force-dynamic";

/**
 * Asistent AI (krok 4, Jakub 10. 10. 2026).
 *
 * **Vidí i používá jen administrátor** — ostatním 404, klientská část ho
 * nemá. Klienti jdou k Anthropicu jen pod přezdívkou, bez kontaktů,
 * poznámek (`src/lib/asistent/`).
 */
export default async function AsistentPage() {
  const viewer = await requireAdmin();

  if (jeUkazka()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>V ukázce je Asistent AI vypnutý</CardTitle>
          <CardDescription>
            Odpovídá nad daty z CRM — otázky by odcházely k Anthropicu, a ukázka ven nic nepouští.
            Klienti by k AI šli jen pod přezdívkou, bez e-mailů a telefonů.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!asistentZapnuty()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Asistent AI zatím není zapnutý</CardTitle>
          <CardDescription>
            Chybí klíč k Anthropicu (proměnná <code>ANTHROPIC_API_KEY</code>). Dokud tu není, nic se
            nikam neodesílá.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <Rozhovor zbyva={await zbyvaOtazek(viewer)} limit={DENNI_LIMIT} />;
}
