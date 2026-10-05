"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { nastavUpozorneni, odeberZarizeni, ulozZarizeni, zkusOznameni } from "./oznameni-actions";

/**
 * Oznámení v Mém profilu klienta (krok 3A, Jakub 4. 10. 2026).
 *
 * - **Vypínač** platí pro celý účet: oznámení i náhradní e-mail.
 * - **Tohle zařízení:** povolení oznámení v prohlížeči. Na iPhonu jen
 *   z aplikace na ploše (iOS 16.4+), jinak tam prohlížeč oznámení nemá.
 *
 * Service worker se registruje s rozsahem `/ucet`, takže do CRM týmu
 * nezasahuje (`public/sw-klient.js`).
 */

type Stav = "zjistuji" | "nepodporuje" | "ios-mimo-plochu" | "zakazano" | "povoleno" | "nepovoleno";

const ROZSAH = "/ucet";

/** Veřejný klíč z base64url na bajty, jak je chce `pushManager.subscribe()`. */
function naBajty(base64: string): Uint8Array<ArrayBuffer> {
  const doplneno = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const text = window.atob(doplneno);
  const bajty = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i += 1) bajty[i] = text.charCodeAt(i);
  return bajty;
}

function jeIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPad se od iPadOS 13 hlásí jako Mac — pozná se podle dotyku.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function jeNaPlose(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

async function registrace(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw-klient.js", {
    scope: ROZSAH,
    updateViaCache: "none",
  });
}

export function OznameniKlienta({
  zapnuto,
  verejnyKlic,
  zarizeni,
}: {
  zapnuto: boolean;
  /** `null` = na serveru oznámení nejsou (chybí klíče) — zůstává e-mail. */
  verejnyKlic: string | null;
  zarizeni: { device: string | null; od: string }[];
}) {
  const router = useRouter();
  const [stav, setStav] = useState<Stav>("zjistuji");
  const [ceka, zahaj] = useTransition();

  // Zjištění, co tohle zařízení umí. Když je přihlášené v prohlížeči,
  // ale server o něm neví (třeba po zrušení), tiše se uloží znovu.
  useEffect(() => {
    let zruseno = false;
    (async () => {
      const podporuje =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let novy: Stav;
      if (!podporuje) {
        novy = jeIos() && !jeNaPlose() ? "ios-mimo-plochu" : "nepodporuje";
      } else if (Notification.permission === "denied") {
        novy = "zakazano";
      } else {
        const reg = await navigator.serviceWorker.getRegistration(ROZSAH);
        const sub = await reg?.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          novy = "povoleno";
          await ulozZarizeni(sub.toJSON());
        } else {
          novy = "nepovoleno";
        }
      }
      if (!zruseno) setStav(novy);
    })().catch(() => {
      if (!zruseno) setStav("nepodporuje");
    });
    return () => {
      zruseno = true;
    };
  }, []);

  function povolit() {
    if (!verejnyKlic) return;
    zahaj(async () => {
      try {
        const souhlas = await Notification.requestPermission();
        if (souhlas !== "granted") {
          setStav(souhlas === "denied" ? "zakazano" : "nepovoleno");
          return;
        }
        await registrace();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: naBajty(verejnyKlic),
        });
        const vysledek = await ulozZarizeni(sub.toJSON());
        if (!vysledek.ok) {
          await sub.unsubscribe().catch(() => {});
          toast.error(vysledek.chyba);
          return;
        }
        setStav("povoleno");
        toast.success(vysledek.zprava ?? "Oznámení jsou povolená.");
        router.refresh();
      } catch {
        toast.error("Oznámení se nepodařilo povolit. Zkuste to prosím znovu.");
      }
    });
  }

  function vypnoutTady() {
    zahaj(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration(ROZSAH);
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await odeberZarizeni(sub.endpoint);
          await sub.unsubscribe().catch(() => {});
        }
        setStav("nepovoleno");
        toast.success("Na tomhle zařízení oznámení nepřijdou.");
        router.refresh();
      } catch {
        toast.error("Oznámení se nepodařilo vypnout. Zkuste to prosím znovu.");
      }
    });
  }

  function vyzkouset() {
    zahaj(async () => {
      const vysledek = await zkusOznameni();
      if (vysledek.ok) toast.success(vysledek.zprava ?? "Odesláno.");
      else toast.error(vysledek.chyba);
    });
  }

  function prepnout(zapnout: boolean) {
    zahaj(async () => {
      const vysledek = await nastavUpozorneni(zapnout);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava ?? "Uloženo.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upozornění</CardTitle>
        <CardDescription>
          Dáme vám vědět o zaplacené objednávce, povoleném přístupu do programu, blížícím se konci
          členství a o zprávách od nás. Když nemáte oznámení povolená na žádném zařízení, pošleme
          vám upozornění e-mailem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {zapnuto ? (
              <>
                Upozornění jsou <strong>zapnutá</strong>.
              </>
            ) : (
              <>
                Upozornění jsou <strong>vypnutá</strong> — nepřijde vám nic, zprávy od nás najdete v
                sekci Zprávy.
              </>
            )}
          </p>
          <Button variant="outline" size="sm" disabled={ceka} onClick={() => prepnout(!zapnuto)}>
            {zapnuto ? <BellOff /> : <Bell />}
            {zapnuto ? "Vypnout upozornění" : "Zapnout upozornění"}
          </Button>
        </div>

        {zapnuto && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Oznámení na tomto zařízení</h3>
            <StavZarizeni
              stav={stav}
              verejnyKlic={verejnyKlic}
              ceka={ceka}
              povolit={povolit}
              vypnout={vypnoutTady}
              vyzkouset={vyzkouset}
            />
          </div>
        )}

        {zarizeni.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">
              Zařízení s povolenými oznámeními ({zarizeni.length})
            </h3>
            <ul className="text-muted-foreground space-y-1 text-sm">
              {zarizeni.map((z, i) => (
                <li key={i}>
                  {z.device ?? "zařízení"} · od {z.od}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StavZarizeni({
  stav,
  verejnyKlic,
  ceka,
  povolit,
  vypnout,
  vyzkouset,
}: {
  stav: Stav;
  verejnyKlic: string | null;
  ceka: boolean;
  povolit: () => void;
  vypnout: () => void;
  vyzkouset: () => void;
}) {
  if (stav === "zjistuji") {
    return <p className="text-muted-foreground text-sm">Zjišťuji, co tohle zařízení umí…</p>;
  }

  if (stav === "ios-mimo-plochu") {
    return (
      <Alert>
        <AlertDescription className="space-y-1 text-sm">
          <p>Na iPhonu a iPadu chodí oznámení jen z aplikace na ploše:</p>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>
              Dole v Safari klepněte na <strong>Sdílet</strong> (čtvereček se šipkou nahoru).
            </li>
            <li>
              Vyberte <strong>Přidat na plochu</strong>.
            </li>
            <li>Otevřete aplikaci Beat Stock z plochy a oznámení povolte tady v Mém profilu.</li>
          </ol>
        </AlertDescription>
      </Alert>
    );
  }

  if (stav === "nepodporuje") {
    return (
      <p className="text-muted-foreground text-sm">
        Tento prohlížeč oznámení neumí. Upozornění vám budou chodit e-mailem.
      </p>
    );
  }

  if (stav === "zakazano") {
    return (
      <p className="text-muted-foreground text-sm">
        Oznámení máte v prohlížeči pro tuto stránku zakázaná. Povolte je v nastavení prohlížeče (u
        adresy stránky) a pak se sem vraťte.
      </p>
    );
  }

  if (!verejnyKlic) {
    return (
      <p className="text-muted-foreground text-sm">
        Oznámení v telefonu zatím nemáme zapnutá. Upozornění vám budou chodit e-mailem.
      </p>
    );
  }

  if (stav === "povoleno") {
    return (
      <div className="space-y-3">
        <p className="text-sm">Na tomto zařízení jsou oznámení povolená.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={ceka} onClick={vyzkouset}>
            <Send />
            Poslat zkušební oznámení
          </Button>
          <Button variant="outline" size="sm" disabled={ceka} onClick={vypnout}>
            <BellOff />
            Vypnout na tomto zařízení
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button size="sm" disabled={ceka} onClick={povolit}>
      {ceka ? <Loader2 className="animate-spin" /> : <Bell />}
      Povolit oznámení na tomto zařízení
    </Button>
  );
}
