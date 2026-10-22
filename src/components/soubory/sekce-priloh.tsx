import { Paperclip } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireViewer } from "@/lib/session";
import { nactiSoubory, smiNahravat, smiVidet } from "@/lib/soubory";
import { jeUkazka } from "@/lib/ukazka";
import { kamNahravat } from "@/lib/uloziste";
import type { AttachmentOwner } from "@/generated/prisma/enums";

import { Prilohy } from "./prilohy";

/**
 * Hotová sekce Přílohy k vložení do libovolné obrazovky.
 *
 * Načte soubory, spočítá oprávnění **na serveru** a předá už jen to, co
 * má přihlášený vidět. Obrazovka, která ji použije, o souborech nemusí
 * vědět nic:
 *
 * ```tsx
 * <SekcePriloh typ="UZIVATEL" id={uzivatel.id} />
 * ```
 *
 * Kdo nemá na záznam právo, nedostane sekci vůbec — a kdyby se na
 * adresu souboru trefil, odmítne ho i `/api/soubory/[id]`.
 */
export async function SekcePriloh({
  typ,
  id,
  popis,
  bezRamu,
}: {
  typ: AttachmentOwner;
  id: string;
  popis?: string;
  /** Vykreslí jen obsah, bez karty — pro vložení do okna (`PrilohyDialog`). */
  bezRamu?: boolean;
}) {
  // Komu chybí povinné dvoufázové ověření, tomu soubory stejně
  // nevydáme (`/api/soubory/[id]` ho odmítne) — sekci ať nevidí vůbec.
  const viewer = await requireViewer({ bezDvoufazoveho: true });
  if (viewer.chybiDvoufazove) return null;

  if (!(await smiVidet(viewer, typ, id))) return null;

  const [soubory, muzeNahravat] = await Promise.all([
    nactiSoubory(viewer, typ, id),
    smiNahravat(viewer, typ, id),
  ]);

  const obsah = (
    <Prilohy
      typ={typ}
      id={id}
      soubory={soubory}
      smiNahravat={muzeNahravat}
      uloziste={kamNahravat()}
      ukazka={jeUkazka()}
      // Free tarif úložiště neumí soubory uzamknout (security.md).
      // U klienta se to říká důrazněji — jsou to údaje někoho, kdo
      // o tom neví (Jakub, 21. 9. 2026).
      varovani={typ === "KLIENT" ? "klient" : "uzivatel"}
    />
  );

  if (bezRamu) return obsah;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
          Přílohy
        </CardTitle>
        <CardDescription>
          {popis ?? "Soubory u tohohle záznamu. Smazat soubor smí ten, kdo ho nahrál, a správce."}
        </CardDescription>
      </CardHeader>
      <CardContent>{obsah}</CardContent>
    </Card>
  );
}
