import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Stránkování seznamu.
 *
 * Odkazy, ne tlačítka s obsluhou v prohlížeči: číslo stránky patří do
 * adresy, takže konkrétní stránka jde poslat odkazem a funguje i tlačítko
 * zpět. Server pak načte jen tu jednu stránku — do prohlížeče se nikdy
 * neposílá celý seznam.
 */
export function Strankovani({
  stranka,
  stranek,
  celkem,
  adresa,
}: {
  stranka: number;
  stranek: number;
  celkem: number;
  /** Vrátí adresu dané stránky i s ostatními filtry. */
  adresa: (stranka: number) => string;
}) {
  if (stranek <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-muted-foreground text-sm">
        Stránka <span className="tabular">{stranka}</span> z{" "}
        <span className="tabular">{stranek}</span> — celkem{" "}
        <span className="tabular">{celkem}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button asChild={stranka > 1} variant="outline" size="sm" disabled={stranka <= 1}>
          {stranka > 1 ? (
            <Link href={adresa(stranka - 1)} scroll={false}>
              <ChevronLeft />
              Předchozí
            </Link>
          ) : (
            <span>
              <ChevronLeft />
              Předchozí
            </span>
          )}
        </Button>

        <Button
          asChild={stranka < stranek}
          variant="outline"
          size="sm"
          disabled={stranka >= stranek}
        >
          {stranka < stranek ? (
            <Link href={adresa(stranka + 1)} scroll={false}>
              Další
              <ChevronRight />
            </Link>
          ) : (
            <span>
              Další
              <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
