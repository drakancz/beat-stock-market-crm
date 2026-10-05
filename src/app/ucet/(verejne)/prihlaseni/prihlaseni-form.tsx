"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chybaKlientaCesky } from "@/lib/klient/hlasky";

import { prihlasitKlienta } from "./actions";

/**
 * Přihlášení klienta — stejně jako u týmu jeden formulář ve dvou krocích:
 * e-mail a heslo, a když má účet dvoufázové ověření, doptá se na kód.
 * Že účet kód má, se dozví jen ten, kdo zná heslo.
 */
export function PrihlaseniKlientaForm() {
  const router = useRouter();
  const parametry = useSearchParams();
  // Po změně hesla v profilu — jen věta podle pevné hodnoty, nic z adresy se nevypisuje.
  const hesloZmeneno = parametry.get("heslo") === "zmeneno";

  const [kodPotreba, setKodPotreba] = useState(false);
  const [zalozni, setZalozni] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [odesila, setOdesila] = useState(false);

  async function odeslat(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setChyba(null);
    setOdesila(true);

    const vysledek = await prihlasitKlienta(new FormData(event.currentTarget));
    setOdesila(false);

    if (vysledek.ok) {
      router.push("/ucet");
      router.refresh();
      return;
    }
    if (vysledek.kod === "potreba_kod") {
      setKodPotreba(true);
      return;
    }
    setChyba(chybaKlientaCesky(vysledek.kod));
  }

  // `method="post"`: kdyby obsluha neproběhla, heslo nesmí skončit v adrese.
  return (
    <form onSubmit={odeslat} method="post" className="space-y-4">
      {chyba && (
        <Alert variant="destructive">
          <AlertDescription>{chyba}</AlertDescription>
        </Alert>
      )}

      {hesloZmeneno && !chyba && !kodPotreba && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>
            Heslo je změněné a všechna zařízení jsou odhlášená. Přihlaste se novým heslem.
          </AlertDescription>
        </Alert>
      )}

      {kodPotreba && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>
            Heslo sedí. Ještě opište kód z ověřovací aplikace v telefonu.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus={!kodPotreba}
          readOnly={kodPotreba}
          placeholder="vas@email.cz"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="heslo">Heslo</Label>
          <Link
            href="/ucet/zapomenute-heslo"
            className="text-muted-foreground hover:text-foreground -my-1.5 py-1.5 text-xs underline underline-offset-4"
          >
            Zapomenuté heslo
          </Link>
        </div>
        <Input
          id="heslo"
          name="heslo"
          type="password"
          autoComplete="current-password"
          required
          readOnly={kodPotreba}
        />
      </div>

      {kodPotreba && (
        <div className="space-y-2">
          <Label htmlFor="kod">{zalozni ? "Záložní kód" : "Kód z aplikace"}</Label>
          <Input
            id="kod"
            name="kod"
            inputMode={zalozni ? "text" : "numeric"}
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder={zalozni ? "např. a1b2c3d4e5" : "123456"}
            className={zalozni ? undefined : "text-center font-mono text-lg tracking-[0.4em]"}
          />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={odesila}>
        {odesila && <Loader2 className="animate-spin" />}
        {kodPotreba ? "Ověřit a přihlásit" : "Přihlásit se"}
      </Button>

      {kodPotreba && (
        <button
          type="button"
          onClick={() => {
            setZalozni((stav) => !stav);
            setChyba(null);
          }}
          className="text-muted-foreground hover:text-foreground w-full text-center text-xs underline underline-offset-4"
        >
          {zalozni ? "Zpět na kód z aplikace" : "Nemám telefon — použít záložní kód"}
        </button>
      )}
    </form>
  );
}
