"use client";

import { useRouter } from "next/navigation";

import { COOKIE_JAZYKA, type Jazyk } from "@/lib/jazyk";
import { cn } from "@/lib/utils";

const POPISKY: Record<Jazyk, string> = { cs: "Česky", en: "English" };

// Mimo komponentu: zápis do `document` je vedlejší účinek kliknutí, ne vykreslení.
function ulozJazyk(jazyk: Jazyk) {
  const bezpecna = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE_JAZYKA}=${jazyk}; path=/; max-age=31536000; samesite=lax${bezpecna}`;
}

/**
 * Přepínač Česky / English (viz `src/lib/jazyk.ts`).
 *
 * Volba se uloží do cookie na rok a stránka se znovu vykreslí na serveru.
 * Cookie nenese nic citlivého, proto ji smí zapsat prohlížeč.
 */
export function PrepinacJazyka({ jazyk, className }: { jazyk: Jazyk; className?: string }) {
  const router = useRouter();

  function nastav(novy: Jazyk) {
    ulozJazyk(novy);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label="Jazyk / Language"
      className={cn("inline-flex rounded-md border p-0.5 text-xs", className)}
    >
      {(["cs", "en"] as const).map((j) => (
        <button
          key={j}
          type="button"
          lang={j}
          aria-pressed={jazyk === j}
          onClick={() => nastav(j)}
          className={cn(
            "min-h-6 rounded px-2 font-medium",
            jazyk === j
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {POPISKY[j]}
        </button>
      ))}
    </div>
  );
}
