import { cn } from "@/lib/utils";

/**
 * Logo brokera, nebo zkratka z názvu, když logo chybí.
 *
 * Záměrně obyčejný `<img>`, ne `next/image`: obrázek je na cizím serveru,
 * který si vybral administrátor, a `next/image` by po nás chtěl předem
 * vyjmenovat povolené domény — každý nový broker by pak znamenal zásah
 * do konfigurace a restart aplikace.
 *
 * `referrerPolicy` brání tomu, aby se cizímu serveru posílala adresa
 * obrazovky, ze které se obrázek načítá. Adresy v CRM sice obsahují jen
 * id, ale cizímu serveru do nich nic není.
 */
export function LogoBrokera({
  nazev,
  logo,
  className,
}: {
  nazev: string;
  logo: string | null;
  className?: string;
}) {
  const zkratka = nazev
    .split(/\s+/)
    .slice(0, 2)
    .map((slovo) => slovo[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border text-xs font-semibold",
        className,
      )}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- viz komentář výš: obrázek je na cizí doméně, kterou dopředu neznáme
        <img
          src={logo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-contain"
        />
      ) : (
        <span aria-hidden>{zkratka}</span>
      )}
    </span>
  );
}
