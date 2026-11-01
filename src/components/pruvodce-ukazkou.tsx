"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Circle, Compass, RotateCcw, X } from "lucide-react";

import { PrepinacJazyka } from "@/components/prepinac-jazyka";
import { Button } from "@/components/ui/button";
import type { Jazyk } from "@/lib/jazyk";
import { KROKY_PRUVODCE, type DruhPruvodce, type KrokPruvodce } from "@/lib/pruvodce-ukazkou";
import { TEXTY_VSTUPU } from "@/lib/texty-vstupu";
import { cn } from "@/lib/utils";

/**
 * Průvodce ukázkou „Co si tu vyzkoušet“ (Jakub, 22. 10. 2026).
 *
 * **Kdo ho vidí (Jakub):** jen ukázkový člen týmu a ukázkový klient
 * v ukázkovém režimu, každý vlastní kroky; rozhoduje o tom rám (server).
 * Nic nemění — co je prošlé, si pamatuje jen prohlížeč návštěvníka.
 *
 * Krok se odškrtne sám, když návštěvník otevře jeho stránku, nebo ručně.
 * Při první návštěvě se panel sám rozbalí. Texty jsou česky nebo anglicky
 * podle přepínače v hlavičce (src/lib/jazyk.ts, 23. 10. 2026).
 */

const KLIC = "bsm-pruvodce";

type Ulozeno = { prosle: string[]; otevreno: boolean };

/** Při první návštěvě se panel rozbalí sám. */
const VYCHOZI = JSON.stringify({ prosle: [], otevreno: true } satisfies Ulozeno);

// Úložiště prohlížeče může chybět (anonymní okno) — průvodce si pak
// pamatuje jen do znovunačtení stránky.
const pamet = new Map<string, string>();
const posluchaci = new Set<() => void>();

function precti(druh: DruhPruvodce): string {
  try {
    const text = window.localStorage.getItem(`${KLIC}-${druh}`);
    if (text) return text;
  } catch {
    // Viz výš.
  }
  return pamet.get(druh) ?? VYCHOZI;
}

function zapis(druh: DruhPruvodce, data: Ulozeno) {
  const text = JSON.stringify(data);
  pamet.set(druh, text);
  try {
    window.localStorage.setItem(`${KLIC}-${druh}`, text);
  } catch {
    // Viz výš.
  }
  posluchaci.forEach((posluchac) => posluchac());
}

function prihlas(posluchac: () => void) {
  posluchaci.add(posluchac);
  return () => {
    posluchaci.delete(posluchac);
  };
}

function rozloz(text: string): Ulozeno {
  try {
    const data = JSON.parse(text) as Partial<Ulozeno>;
    return {
      prosle: Array.isArray(data.prosle) ? data.prosle.filter((p) => typeof p === "string") : [],
      otevreno: data.otevreno === true,
    };
  } catch {
    return JSON.parse(VYCHOZI) as Ulozeno;
  }
}

function jePodCestou(pathname: string, { cesta, presne, sParametrem }: KrokPruvodce) {
  if (sParametrem) {
    const parametry = new URLSearchParams(window.location.search);
    if (!sParametrem.some((p) => parametry.get(p))) return false;
  }
  if (presne) return pathname === cesta;
  if (cesta.endsWith("/")) return pathname.startsWith(cesta);
  return pathname === cesta || pathname.startsWith(`${cesta}/`);
}

export function PruvodceUkazkou({ druh, jazyk }: { druh: DruhPruvodce; jazyk: Jazyk }) {
  const kroky = KROKY_PRUVODCE[druh];
  const t = TEXTY_VSTUPU[jazyk].pruvodce;
  const vKroku = (krok: KrokPruvodce) => (jazyk === "en" ? krok.en : krok);
  const pathname = usePathname();
  // Na serveru `null` — úložiště zná jen prohlížeč, panel se ukáže až po hydrataci.
  const text = useSyncExternalStore(
    prihlas,
    () => precti(druh),
    () => null,
  );
  const stav = useMemo(() => (text === null ? null : rozloz(text)), [text]);

  // Otevřená stránka kroku ho odškrtne (i ta, na které se průvodce načetl).
  useEffect(() => {
    if (!stav) return;
    const novy = kroky.find((k) => jePodCestou(pathname, k) && !stav.prosle.includes(k.href));
    if (novy) zapis(druh, { ...stav, prosle: [...stav.prosle, novy.href] });
  }, [pathname, kroky, druh, stav]);

  // Na telefonu by otevřený panel zakryl každou další stránku — sbalí se
  // při přechodu jinam (i spodní lištou). Při prvním načtení zůstane, jak je.
  // Musí běžet až po odškrtnutí výš, které zapisuje ještě starý stav.
  const predchozi = useRef(pathname);
  useEffect(() => {
    if (predchozi.current === pathname) return;
    predchozi.current = pathname;
    if (window.matchMedia("(min-width: 640px)").matches) return;
    const aktualni = rozloz(precti(druh));
    if (aktualni.otevreno) zapis(druh, { ...aktualni, otevreno: false });
  }, [pathname, druh]);

  if (!stav) return null;

  const hotovo = kroky.filter((k) => stav.prosle.includes(k.href)).length;
  const zmen = (zmena: Partial<Ulozeno>) => zapis(druh, { ...stav, ...zmena });
  const prepni = (href: string) =>
    zmen({
      prosle: stav.prosle.includes(href)
        ? stav.prosle.filter((p) => p !== href)
        : [...stav.prosle, href],
    });

  // V klientské části je na telefonu dole pevná lišta navigace.
  const dole =
    druh === "klient"
      ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:bottom-4"
      : "bottom-[calc(1rem+env(safe-area-inset-bottom))]";

  if (!stav.otevreno) {
    return (
      <Button
        type="button"
        onClick={() => zmen({ otevreno: true })}
        className={cn("fixed right-4 z-50 shadow-lg", dole)}
      >
        <Compass />
        <span lang={jazyk}>{t.tlacitko}</span>
        <span className="text-xs opacity-80">
          {hotovo}/{kroky.length}
        </span>
      </Button>
    );
  }

  return (
    <section
      aria-label={t.nadpis}
      lang={jazyk}
      className={cn(
        "bg-background fixed inset-x-3 z-50 max-h-[70svh] overflow-y-auto rounded-xl border shadow-xl sm:inset-x-auto sm:right-4 sm:w-80",
        dole,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{t.nadpis}</h2>
          <p className="text-muted-foreground text-xs">{t.prosli(hotovo, kroky.length)}</p>
          {t.poznamka && <p className="text-muted-foreground mt-1 text-xs">{t.poznamka}</p>}
          <PrepinacJazyka jazyk={jazyk} className="mt-2" />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0"
          aria-label={t.sbalit}
          onClick={() => zmen({ otevreno: false })}
        >
          <X />
        </Button>
      </div>

      <ol className="divide-y">
        {kroky.map((krok) => {
          const prosly = stav.prosle.includes(krok.href);
          return (
            <li key={krok.href} className="flex items-start gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => prepni(krok.href)}
                aria-label={
                  prosly ? t.zrusitOdskrtnuti(vKroku(krok).nazev) : t.odskrtnout(vKroku(krok).nazev)
                }
                aria-pressed={prosly}
                className="text-primary -mx-0.5 -mb-0.5 shrink-0 p-0.5"
              >
                {prosly ? (
                  <CheckCircle2 className="size-5" aria-hidden />
                ) : (
                  <Circle className="text-muted-foreground size-5" aria-hidden />
                )}
              </button>
              <div className="min-w-0">
                <Link
                  href={krok.href}
                  onClick={() => {
                    // Na telefonu by otevřený panel zakryl stránku, na kterou krok vede.
                    if (!window.matchMedia("(min-width: 640px)").matches) zmen({ otevreno: false });
                  }}
                  className={cn(
                    "font-medium underline-offset-4 hover:underline",
                    prosly && "text-muted-foreground line-through",
                  )}
                >
                  {vKroku(krok).nazev}
                </Link>
                <p className="text-muted-foreground text-xs">{vKroku(krok).popis}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {hotovo > 0 && (
        <div className="border-t px-4 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => zmen({ prosle: [] })}>
            <RotateCcw />
            {t.zacitZnovu}
          </Button>
        </div>
      )}
    </section>
  );
}
