"use client";

import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Nabídka „Přidat na plochu" v klientské části (krok 3A, Jakub 4. 10. 2026).
 *
 * - **Android a Chrome v počítači:** prohlížeč dá vědět, že aplikaci jde
 *   nainstalovat (`beforeinstallprompt`), a tlačítko otevře jeho okno.
 * - **iPhone a iPad:** Safari nic takového neumí — ukáže se krátký návod.
 *   Na iPhonu je to zároveň jediná cesta k oznámením.
 *
 * V aplikaci na ploše se nabídka neukazuje. Kdo ji zavře, už ji v tomhle
 * prohlížeči neuvidí (pamatuje si to prohlížeč, ne server).
 */

/** Událost prohlížeče před instalací — TypeScript ji zatím nezná. */
interface UdalostInstalace extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const ZAVRENO = "bsm-instalace-zavrena";

function jeZavrena(): boolean {
  try {
    return window.localStorage.getItem(ZAVRENO) === "1";
  } catch {
    return false;
  }
}

function zapamatujZavreni(): void {
  try {
    window.localStorage.setItem(ZAVRENO, "1");
  } catch {
    // Soukromé okno nebo zakázané úložiště — nabídka se příště ukáže znovu.
  }
}

export function InstalaceAplikace() {
  const [udalost, setUdalost] = useState<UdalostInstalace | null>(null);
  const [ios, setIos] = useState(false);
  const [skryta, setSkryta] = useState(true);

  useEffect(() => {
    const naPlose =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (naPlose || jeZavrena()) return;

    const jeIos =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
    // Na iPhonu jde aplikace přidat jen ze Safari; jiné prohlížeče tam
    // tu volbu nemají, návod by je mátl.
    const safari =
      /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

    const naUdalost = (e: Event) => {
      e.preventDefault();
      setUdalost(e as UdalostInstalace);
      setSkryta(false);
    };
    window.addEventListener("beforeinstallprompt", naUdalost);

    let casovac: number | undefined;
    if (jeIos && safari) {
      // Odložené o tik, ať se stav nemění přímo v efektu při vykreslení.
      casovac = window.setTimeout(() => {
        setIos(true);
        setSkryta(false);
      }, 0);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", naUdalost);
      if (casovac !== undefined) window.clearTimeout(casovac);
    };
  }, []);

  if (skryta) return null;

  function zavrit() {
    zapamatujZavreni();
    setSkryta(true);
  }

  return (
    <aside
      aria-label="Aplikace na plochu"
      className="bg-background flex items-start gap-3 rounded-lg border p-3 text-sm"
    >
      <Smartphone className="text-primary mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">Mějte klientskou část po ruce jako aplikaci</p>
        {ios ? (
          <p className="text-muted-foreground">
            V Safari klepněte dole na <strong>Sdílet</strong> (čtvereček se šipkou) a vyberte{" "}
            <strong>Přidat na plochu</strong>. Z aplikace na ploše vám pak můžou chodit i oznámení.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Přidejte si ji na plochu — otevře se jedním klepnutím a můžou vám z ní chodit
              oznámení.
            </p>
            <Button
              size="sm"
              onClick={async () => {
                if (!udalost) return;
                await udalost.prompt();
                const volba = await udalost.userChoice;
                setUdalost(null);
                if (volba.outcome === "accepted") setSkryta(true);
              }}
            >
              Přidat na plochu
            </Button>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label="Zavřít nabídku"
        onClick={zavrit}
      >
        <X />
      </Button>
    </aside>
  );
}
