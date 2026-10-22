"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { chybaCesky } from "@/lib/auth-errors";

/**
 * Kam se člověk vrátí po přihlášení (`?pokracovat=`).
 *
 * **Přijme se jen cesta ve vlastní aplikaci.** Kdyby stačilo „začíná
 * lomítkem", prošlo by i `/\evil.com` — prohlížeč zpětné lomítko převede
 * na obyčejné a poslal by čerstvě přihlášeného na cizí web (phishing).
 * Adresa se proto poskládá proti vlastnímu původu a použije se jen tehdy,
 * když u něj zůstane. Jinak výchozí Dnešek.
 */
function bezpecnyCil(pozadovano: string | null): string {
  if (!pozadovano) return "/dashboard";
  try {
    const url = new URL(pozadovano, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // Neplatná adresa — spadne na výchozí.
  }
  return "/dashboard";
}

/**
 * Přihlášení jedním formulářem ve dvou krocích.
 *
 * Nejdřív e-mail a heslo. Když má účet zapnuté dvoufázové ověření, server
 * odpoví kódem `potreba_kod` a formulář se doptá na kód z telefonu.
 * Že účet druhý faktor má, se tím **neprozradí nikomu, kdo nezná heslo** —
 * doptání přijde až po jeho ověření.
 */
export function PrihlaseniForm({ ukazka }: { ukazka?: { email: string; heslo: string } }) {
  const router = useRouter();
  const parametry = useSearchParams();

  const [kodPotreba, setKodPotreba] = useState(false);
  const [zalozni, setZalozni] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [odesila, setOdesila] = useState(false);

  // Kam se má člověk vrátit po přihlášení. Bereme jen cestu uvnitř
  // aplikace — kdyby sem někdo podstrčil adresu na cizí web, poslali
  // bychom mu čerstvě přihlášeného uživatele rovnou do rukou.
  const cil = bezpecnyCil(parametry.get("pokracovat"));

  // Po změně hesla v profilu (26. 9. 2026). Porovnává se s pevnou
  // hodnotou a jen se podle toho ukáže věta — nic z adresy se nevypisuje.
  const hesloZmeneno = parametry.get("heslo") === "zmeneno";

  async function odeslat(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await prihlasit(
      String(data.get("email") ?? ""),
      String(data.get("heslo") ?? ""),
      String(data.get("kod") ?? "").trim(),
    );
  }

  async function prihlasit(email: string, heslo: string, kod = "") {
    setChyba(null);
    setOdesila(true);

    const odpoved = await signIn("credentials", {
      email,
      heslo,
      ...(kod ? { kod } : {}),
      redirect: false,
    });

    setOdesila(false);

    if (odpoved?.code === "potreba_kod") {
      setKodPotreba(true);
      return;
    }

    if (odpoved?.error) {
      setChyba(chybaCesky(odpoved.code ?? odpoved.error));
      return;
    }

    router.push(cil);
    router.refresh();
  }

  /*
   * `method="post"` je tu záměrně: formulář se odesílá obsluhou `onSubmit`,
   * a kdyby ta z jakéhokoli důvodu neproběhla, prohlížeč by ho odeslal
   * postaru. Bez téhle metody by heslo skončilo v adrese — a tím i
   * v historii prohlížeče.
   *
   * Naopak u formulářů, které React řídí přes `action={…}`, se metoda
   * uvádět nesmí. React ji nastavuje sám a jinak hlásí chybu.
   */
  return (
    <form onSubmit={odeslat} method="post" className="space-y-4">
      {/* Ukázkový režim (src/lib/ukazka.ts): údaje jsou veřejné schválně. */}
      {ukazka && !kodPotreba && (
        <div className="bg-muted space-y-3 rounded-lg border p-4">
          <div className="flex items-start gap-2 text-sm">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>Ukázka pro zájemce.</strong> Data jsou vymyšlená a každou noc se obnoví —
              klidně cokoli změň nebo smaž.
            </p>
          </div>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>E-mail</dt>
            <dd className="text-foreground font-mono break-all">{ukazka.email}</dd>
            <dt>Heslo</dt>
            <dd className="text-foreground font-mono break-all">{ukazka.heslo}</dd>
          </dl>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full"
              disabled={odesila}
              onClick={() => prihlasit(ukazka.email, ukazka.heslo)}
            >
              Vyzkoušet jako člen týmu
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/ucet/prihlaseni">Vyzkoušet jako klient</Link>
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
          <AlertDescription>
            Heslo je změněné a všechna zařízení jsou odhlášená. Přihlas se novým heslem.
          </AlertDescription>
        </Alert>
      )}

      {kodPotreba && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>
            Heslo sedí. Ještě opiš kód z ověřovací aplikace v telefonu.
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
          placeholder="jmeno@beatstockmarket.cz"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="heslo">Heslo</Label>
          <Link
            href="/zapomenute-heslo"
            // `py-1.5 -my-1.5`: větší plocha pro prst na telefonu (26. 9. 2026),
            // řádek nad polem se tím nezvětší.
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
