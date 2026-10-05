"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/*
 * Přepínání světlého a tmavého vzhledu (Jakub, 22. 9. 2026).
 *
 * Volba je **jen v prohlížeči toho člověka**, neukládá se do databáze —
 * není to údaj o uživateli, ale nastavení zobrazení. Kdo se přihlásí
 * jinde, začne znovu „podle systému".
 *
 * Výchozí je `system`: aplikace se řídí tím, co má člověk nastavené
 * v počítači nebo v telefonu, dokud si sám nevybere jinak.
 *
 * Knihovna vkládá do stránky malý skript, který nastaví vzhled ještě
 * před vykreslením. Content-Security-Policy ho pustí jen s klíčem
 * (`nonce`) z kořenového rámu — bez něj by stránka problikla.
 */
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      nonce={nonce}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
