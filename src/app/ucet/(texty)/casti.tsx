import { nactiNastaveni } from "@/lib/nastaveni";

/**
 * Společné kousky textů pro klienty.
 *
 * Údaje o firmě se berou z Nastavení → Firma a e-maily (název, IČO,
 * sídlo, kontaktní e-mail) — v textu se nic nevymýšlí. Co administrátor
 * nevyplnil, se prostě nevypíše.
 */

/** Den, od kterého texty platí. Při změně textu ho posuň. */
export const PLATNE_OD = "4. 10. 2026";

export async function udajeFirmy() {
  const nastaveni = await nactiNastaveni();
  return {
    nazev: nastaveni.companyName,
    ico: nastaveni.ico,
    sidlo: nastaveni.address,
    kontakt: nastaveni.contactEmail,
  };
}

/** „Beat Stock Market, IČO 12345678, se sídlem Ulice 1, Praha" */
export function popisFirmy(firma: Awaited<ReturnType<typeof udajeFirmy>>): string {
  return [
    firma.nazev,
    firma.ico ? `IČO ${firma.ico}` : null,
    firma.sidlo ? `se sídlem ${firma.sidlo}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function Kontakt({ email }: { email: string | null }) {
  if (!email) return <>e-mailem na adresu uvedenou na našem webu</>;
  return (
    <>
      e-mailem na{" "}
      <a href={`mailto:${email}`} className="text-foreground font-medium underline">
        {email}
      </a>
    </>
  );
}

export function Nadpis({ children }: { children: React.ReactNode }) {
  return (
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-semibold">{children}</h1>
      <p className="text-muted-foreground text-sm">Platné od {PLATNE_OD}</p>
    </header>
  );
}

export function Oddil({ nazev, children }: { nazev: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 space-y-2 text-sm leading-relaxed">
      <h2 className="text-base font-semibold">{nazev}</h2>
      {children}
    </section>
  );
}

export const SEZNAM = "list-disc space-y-1 pl-5";
