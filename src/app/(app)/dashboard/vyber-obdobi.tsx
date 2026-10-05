import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PREDVOLBY, type Obdobi } from "@/lib/obdobi";
import { cn } from "@/lib/utils";

/**
 * Výběr období.
 *
 * Volba žije **v adrese**, ne ve stavu komponenty — vyfiltrovaný přehled
 * se dá poslat odkazem a přežije obnovení stránky. Předvolby jsou proto
 * obyčejné odkazy a vlastní rozsah obyčejný formulář, který se odesílá
 * metodou GET. Nic z toho nepotřebuje JavaScript v prohlížeči.
 *
 * Co přijde z adresy, se na serveru přijme jen z uzavřeného seznamu
 * (`prectiObdobi()` v `src/lib/obdobi.ts`) — pole níž jsou pohodlí,
 * ne kontrola.
 *
 * Používá ho Dashboard i Nastavení → Aktivita. `zachovat` jsou ostatní
 * filtry z adresy, které se změnou období nemají ztratit.
 */
export function VyberObdobi({
  obdobi,
  cesta = "/dashboard",
  zachovat = {},
}: {
  obdobi: Obdobi;
  cesta?: string;
  zachovat?: Record<string, string | undefined>;
}) {
  const odkaz = (id: string) => {
    const dotaz = new URLSearchParams();
    for (const [klic, hodnota] of Object.entries(zachovat)) {
      if (hodnota) dotaz.set(klic, hodnota);
    }
    dotaz.set("obdobi", id);
    return `${cesta}?${dotaz.toString()}`;
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Období">
        {PREDVOLBY.filter((polozka) => polozka.id !== "vlastni").map((polozka) => {
          const vybrane = polozka.id === obdobi.id;

          return (
            <Button
              key={polozka.id}
              asChild
              size="sm"
              variant={vybrane ? "default" : "outline"}
              className={cn(!vybrane && "text-muted-foreground")}
            >
              <Link href={odkaz(polozka.id)} aria-current={vybrane ? "page" : undefined}>
                {polozka.label}
              </Link>
            </Button>
          );
        })}
      </div>

      <form action={cesta} method="get" className="flex flex-wrap items-center gap-1.5">
        {Object.entries(zachovat).map(([klic, hodnota]) =>
          hodnota ? <input key={klic} type="hidden" name={klic} value={hodnota} /> : null,
        )}
        <input type="hidden" name="obdobi" value="vlastni" />
        <label htmlFor="od" className="text-muted-foreground text-sm">
          Od
        </label>
        <Input
          id="od"
          type="date"
          name="od"
          defaultValue={obdobi.prvniDen}
          max={obdobi.posledniDen}
          className="w-auto"
        />
        <label htmlFor="do" className="text-muted-foreground text-sm">
          do
        </label>
        <Input id="do" type="date" name="do" defaultValue={obdobi.posledniDen} className="w-auto" />
        <Button type="submit" size="sm" variant={obdobi.id === "vlastni" ? "default" : "outline"}>
          Zobrazit
        </Button>
      </form>
    </div>
  );
}
