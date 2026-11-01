import { ArrowLeft } from "lucide-react";

import type { Jazyk } from "@/lib/jazyk";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";
import { adresaLandingPage } from "@/lib/ukazka";

/**
 * Odkaz z veřejných stránek ukázky zpět na Landing Page (krok 1C,
 * Jakub 26. 10. 2026). **Vidí ho kdokoli nepřihlášený, ale jen v ukázkovém
 * režimu** — nenese žádná data. Anglicky vede na anglickou verzi (`/en/`).
 * Obyčejný `<a>`, ne `Link`: Landing Page je jiný web.
 */
export function ZpetNaLandingPage({ jazyk }: { jazyk: Jazyk }) {
  const adresa = adresaLandingPage();
  if (!adresa) return null;
  const cil = jazyk === "en" ? new URL("/en/", adresa) : adresa;
  return (
    <a
      href={cil.toString()}
      lang={jazyk}
      className="text-muted-foreground hover:text-foreground inline-flex min-h-6 items-center gap-1.5 text-sm underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {TEXTY_VSTUPU[jazyk].zpetNaLandingPage}
    </a>
  );
}
