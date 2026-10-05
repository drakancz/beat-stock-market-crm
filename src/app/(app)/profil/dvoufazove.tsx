"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { potvrdDvoufazove, vypniDvoufazove, zapniDvoufazove } from "./actions";

type Faze =
  | { krok: "vypnuto" }
  | { krok: "zapnuto" }
  | { krok: "nastavuje"; qr: string; klic: string; zalozniKody: string[] };

export function Dvoufazove({ zapnuto }: { zapnuto: boolean }) {
  const router = useRouter();
  const [faze, setFaze] = useState<Faze>(zapnuto ? { krok: "zapnuto" } : { krok: "vypnuto" });
  const [ceka, zahaj] = useTransition();

  if (faze.krok === "nastavuje") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dokonči nastavení</CardTitle>
          <CardDescription>
            Načti QR kód ověřovací aplikací v telefonu (Google Authenticator, 1Password, Bitwarden a
            další) a opiš první kód, který ti ukáže.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex justify-center">
            <div
              className="w-48 rounded-md bg-white p-3 [&_svg]:h-auto [&_svg]:w-full"
              // QR kód vykreslený na serveru. Neobsahuje nic, co by se
              // dalo zneužít bez přístupu k tomuhle oknu.
              dangerouslySetInnerHTML={{ __html: faze.qr }}
            />
          </div>

          {/* Klíč k ručnímu opsání (26. 9. 2026) — na telefonu QR kód
              nejde naskenovat tímtéž telefonem. Po čtveřicích, ať se
              dobře opisuje; aplikace mezery ignorují. */}
          <div className="space-y-1 text-center">
            <p className="text-muted-foreground text-xs">
              QR kód nejde naskenovat? V aplikaci zvol ruční zadání a opiš klíč:
            </p>
            <p className="font-mono text-sm break-all select-all">
              {faze.klic.match(/.{1,4}/g)?.join(" ")}
            </p>
          </div>

          <Alert>
            <AlertTitle>Záložní kódy</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-xs leading-relaxed">
                Ulož si je někam mimo telefon. Když o telefon přijdeš, jsou jediná cesta zpátky do
                systému. Každý se dá použít jednou a už se znovu nezobrazí.
              </p>
              <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-3">
                {faze.zalozniKody.map((kod) => (
                  <span key={kod}>{kod}</span>
                ))}
              </div>
            </AlertDescription>
          </Alert>

          <form
            action={(formData) =>
              zahaj(async () => {
                const vysledek = await potvrdDvoufazove(formData);
                if (!vysledek.ok) {
                  toast.error(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava ?? "Hotovo.");
                setFaze({ krok: "zapnuto" });
                router.refresh();
              })
            }
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="kod">Kód z aplikace</Label>
              <Input
                id="kod"
                name="kod"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>
            <Button type="submit" className="w-full" disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Potvrdit a zapnout
            </Button>
            {/* Rozmyslel se — nepotvrzené nastavení se přihlášení netýká
                (`confirmedAt` je prázdné), takže stačí vrátit obrazovku. */}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={ceka}
              onClick={() => setFaze({ krok: "vypnuto" })}
            >
              Zrušit
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const jeZapnuto = faze.krok === "zapnuto";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {jeZapnuto ? (
            <ShieldCheck className="size-4" aria-hidden />
          ) : (
            <ShieldOff className="text-muted-foreground size-4" aria-hidden />
          )}
          Dvoufázové ověření
        </CardTitle>
        <CardDescription>
          {jeZapnuto
            ? "Při přihlášení se kromě hesla ptáme na kód z tvého telefonu."
            : "Druhý krok při přihlášení. Kdo zná tvoje heslo, bez telefonu se dovnitř nedostane."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            zahaj(async () => {
              const vysledek = jeZapnuto
                ? await vypniDvoufazove(formData)
                : await zapniDvoufazove(formData);

              if (!vysledek.ok) {
                toast.error(vysledek.chyba);
                return;
              }

              if (vysledek.qr && vysledek.klic && vysledek.zalozniKody) {
                setFaze({
                  krok: "nastavuje",
                  qr: vysledek.qr,
                  klic: vysledek.klic,
                  zalozniKody: vysledek.zalozniKody,
                });
                return;
              }

              toast.success(vysledek.zprava ?? "Hotovo.");
              setFaze({ krok: "vypnuto" });
              router.refresh();
            })
          }
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="heslo-2fa">Pro potvrzení zadej svoje heslo</Label>
            <Input
              id="heslo-2fa"
              name="heslo"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" variant={jeZapnuto ? "outline" : "default"} disabled={ceka}>
            {ceka && <Loader2 className="animate-spin" />}
            {jeZapnuto ? "Vypnout" : "Zapnout"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
