"use server";

import { z } from "zod";

import { signIn } from "@/lib/auth";
import { posliUvitani } from "@/lib/email";
import { nastavHesloTokenem } from "@/lib/tokeny";

/**
 * Nastavení hesla z jednorázového odkazu.
 *
 * Celá kontrola — platnost odkazu, jednorázovost, délka hesla — probíhá
 * na serveru. To, co hlídá prohlížeč, je jen zdvořilost vůči uživateli
 * (security_warnings.md, pravidlo 11).
 *
 * Po úspěchu se uživatel rovnou přihlásí. Heslo právě zadal, takže mu ho
 * nemá smysl vyžadovat podruhé — a u pozvánky do systému je to první
 * a jediný krok, který po něm chceme.
 */

const vstup = z.object({
  token: z.string().trim().min(10).max(200),
  heslo: z.string().min(1).max(128),
});

export type VysledekHesla = { ok: true; prihlasen: boolean } | { ok: false; chyba: string };

export async function nastavHeslo(formData: FormData): Promise<VysledekHesla> {
  const data = vstup.safeParse({
    token: formData.get("token"),
    heslo: formData.get("heslo"),
  });

  if (!data.success) {
    return { ok: false, chyba: "Odkaz je neúplný nebo už neplatí." };
  }

  const vysledek = await nastavHesloTokenem(data.data.token, data.data.heslo);
  if (!vysledek.ok) return vysledek;

  // Uvítání jen při prvním nastavení hesla. Po obnově zapomenutého hesla
  // by bylo matoucí — člověk se do systému nevrací poprvé.
  if (vysledek.prvniNastaveni) {
    await posliUvitani({
      komu: vysledek.email,
      osloveni: vysledek.osloveni,
      userId: vysledek.userId,
      spustilId: vysledek.userId,
    });
  }

  // Účet s dvoufázovým ověřením se přihlásit rovnou nedá — chybí kód
  // z telefonu. Takový člověk projde běžným přihlášením.
  if (vysledek.dvoufazove) return { ok: true, prihlasen: false };

  try {
    await signIn("credentials", {
      email: vysledek.email,
      heslo: data.data.heslo,
      redirect: false,
    });
    return { ok: true, prihlasen: true };
  } catch {
    // Heslo je nastavené — to je to podstatné. Když se automatické
    // přihlášení nepovede, uživatel se prostě přihlásí sám.
    return { ok: true, prihlasen: false };
  }
}
