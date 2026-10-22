"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Circle, Compass, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { KROKY_PRUVODCE, type DruhPruvodce, type KrokPruvodce } from "@/lib/pruvodce-ukazkou";
import { cn } from "@/lib/utils";

/**
 * Průvodce ukázkou „Co si tu vyzkoušet“ (Jakub, 22. 10. 2026).
 *
 * **Kdo ho vidí (Jakub):** jen ukázkový člen týmu a ukázkový klient
 * v ukázkovém režimu, každý vlastní kroky; rozhoduje o tom rám (server).
 * Nic nemění — co je prošlé, si pamatuje jen prohlížeč návštěvníka.
 *
 * Krok se odškrtne sám, když návštěvník otevře jeho stránku, nebo ručně.
 * Při první návštěvě se panel sám rozbalí.
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

function jePodCestou(pathname: string, { cesta, presne }: KrokPruvodce) {
  if (presne) return pathname === cesta;
  if (cesta.endsWith("/")) return pathname.startsWith(cesta);
  return pathname === cesta || pathname.startsWith(`${cesta}/`);
}

export function PruvodceUkazkou({ druh }: { druh: DruhPruvodce }) {
  const kroky = KROKY_PRUVODCE[druh];
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
        Co si vyzkoušet
        <span className="text-xs opacity-80">
          {hotovo}/{kroky.length}
        </span>
      </Button>
    );
  }

  return (
    <section
      aria-label="Co si tu vyzkoušet"
      className={cn(
        "bg-background fixed inset-x-3 z-50 max-h-[70svh] overflow-y-auto rounded-xl border shadow-xl sm:inset-x-auto sm:right-4 sm:w-80",
        dole,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Co si tu vyzkoušet</h2>
          <p className="text-muted-foreground text-xs">
            Prošli jste {hotovo} z {kroky.length}. Klidně cokoli změňte — v noci se vše vrátí.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0"
          aria-label="Sbalit průvodce"
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
                  prosly ? `Zrušit odškrtnutí: ${krok.nazev}` : `Odškrtnout: ${krok.nazev}`
                }
                aria-pressed={prosly}
                className="text-primary mt-0.5 shrink-0"
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
                  {krok.nazev}
                </Link>
                <p className="text-muted-foreground text-xs">{krok.popis}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {hotovo > 0 && (
        <div className="border-t px-4 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => zmen({ prosle: [] })}>
            <RotateCcw />
            Začít znovu
          </Button>
        </div>
      )}
    </section>
  );
}
