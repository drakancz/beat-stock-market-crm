"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Jazyk } from "@/lib/jazyk";
import { chybaPrihlaseni, TEXTY_VSTUPU } from "@/lib/texty-vstupu";

import { prihlasitKlienta } from "./actions";

/**
 * Přihlášení klienta — stejně jako u týmu jeden formulář ve dvou krocích:
 * e-mail a heslo, a když má účet dvoufázové ověření, doptá se na kód.
 * Že účet kód má, se dozví jen ten, kdo zná heslo.
 */
export function PrihlaseniKlientaForm({
  jazyk,
  ukazka,
}: {
  jazyk: Jazyk;
  ukazka?: { email: string; heslo: string };
}) {
  const f = TEXTY_VSTUPU[jazyk].formular;
  const t = TEXTY_VSTUPU[jazyk].klient;
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
    await prihlasit(new FormData(event.currentTarget));
  }

  /** Ukázkový režim: přihlášení jedním klikem veřejnými údaji. */
  async function prihlasitUkazku(udaje: { email: string; heslo: string }) {
    const data = new FormData();
    data.set("email", udaje.email);
    data.set("heslo", udaje.heslo);
    await prihlasit(data);
  }

  async function prihlasit(data: FormData) {
    setChyba(null);
    setOdesila(true);

    const vysledek = await prihlasitKlienta(data);
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
    setChyba(chybaPrihlaseni(jazyk, "klient", vysledek.kod));
  }

  // `method="post"`: kdyby obsluha neproběhla, heslo nesmí skončit v adrese.
  return (
    <form onSubmit={odeslat} method="post" className="space-y-4">
      {/* Ukázkový režim (src/lib/ukazka.ts): údaje jsou veřejné schválně. */}
      {ukazka && !kodPotreba && (
        <div className="bg-muted space-y-3 rounded-lg border p-4">
          <div className="flex items-start gap-2 text-sm">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>{f.ukazkaNadpis}</strong> {t.ukazka}
            </p>
          </div>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>{f.email}</dt>
            <dd className="text-foreground font-mono break-all">{ukazka.email}</dd>
            <dt>{f.heslo}</dt>
            <dd className="text-foreground font-mono break-all">{ukazka.heslo}</dd>
          </dl>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full"
              disabled={odesila}
              onClick={() => prihlasitUkazku(ukazka)}
            >
              {f.jakoKlient}
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/prihlaseni">{f.jakoTym}</Link>
            </Button>
          </div>
        </div>
      )}

      {chyba && (
        <Alert variant="destructive">
          <AlertDescription>{chyba}</AlertDescription>
        </Alert>
      )}

      {hesloZmeneno && !chyba && !kodPotreba && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>{t.hesloZmeneno}</AlertDescription>
        </Alert>
      )}

      {kodPotreba && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>{t.kodPotreba}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">{f.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus={!kodPotreba}
          readOnly={kodPotreba}
          placeholder={t.vychoziEmail}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="heslo">{f.heslo}</Label>
          <Link
            href="/ucet/zapomenute-heslo"
            className="text-muted-foreground hover:text-foreground -my-1.5 py-1.5 text-xs underline underline-offset-4"
          >
            {f.zapomenute}
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
          <Label htmlFor="kod">{zalozni ? f.zalozniKod : f.kodZAplikace}</Label>
          <Input
            id="kod"
            name="kod"
            inputMode={zalozni ? "text" : "numeric"}
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder={zalozni ? f.prikladZalozniho : "123456"}
            className={zalozni ? undefined : "text-center font-mono text-lg tracking-[0.4em]"}
          />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={odesila}>
        {odesila && <Loader2 className="animate-spin" />}
        {kodPotreba ? f.overitAPrihlasit : f.prihlasitSe}
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
          {zalozni ? f.zpetNaKod : f.bezTelefonu}
        </button>
      )}
    </form>
  );
}
