import {
  Flame,
  Footprints,
  Lock,
  Milestone,
  Trophy,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import type { BadgeKind } from "@/generated/prisma/enums";
import { formatDatum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { POPIS_ODZNAKU, PORADI_ODZNAKU, type Odznak } from "@/lib/vzdelavani/odznaky";

/**
 * Odznaky jako medaile na Přehledu klienta (krok 3, varianta B, Jakub
 * 10. 10. 2026). Všech šest druhů: získané barevně podle druhu (kurzy
 * modře, aktivita zeleně, webináře jantarově), nezískané šedé se zámkem
 * a větou, jak je získat. Odznaky jsou jen za vzdělávání a aktivitu
 * (security_warnings.md, pravidlo 9).
 */

const IKONA: Record<BadgeKind, LucideIcon> = {
  PRVNI_LEKCE: Footprints,
  PULKA_KURZU: Milestone,
  KURZ_DOKONCEN: Trophy,
  AKTIVNI_4_TYDNY: Flame,
  PRVNI_WEBINAR: Video,
  PET_WEBINARU: Users,
};

const BARVA: Record<BadgeKind, string> = {
  PRVNI_LEKCE: "border-primary bg-primary/10 text-primary",
  PULKA_KURZU: "border-primary bg-primary/10 text-primary",
  KURZ_DOKONCEN: "border-primary bg-primary/10 text-primary",
  AKTIVNI_4_TYDNY: "border-pristup-ano-foreground bg-pristup-ano text-pristup-ano-foreground",
  PRVNI_WEBINAR:
    "border-konec-clenstvi-foreground bg-konec-clenstvi text-konec-clenstvi-foreground",
  PET_WEBINARU: "border-konec-clenstvi-foreground bg-konec-clenstvi text-konec-clenstvi-foreground",
};

/** Kolik druhů odznaků klient má (z šesti). */
export function pocetZiskanych(odznaky: Odznak[]): number {
  return new Set(odznaky.map((odznak) => odznak.kind)).size;
}

export function MedaileOdznaku({ odznaky }: { odznaky: Odznak[] }) {
  return (
    <ul
      className="grid gap-x-3 gap-y-4 min-[480px]:grid-cols-2 md:grid-cols-3"
      aria-label="Odznaky"
    >
      {PORADI_ODZNAKU.map((kind) => {
        const ziskane = odznaky.filter((odznak) => odznak.kind === kind);
        const ma = ziskane.length > 0;
        const Ikona = IKONA[kind];
        const kurzy = [...new Set(ziskane.map((odznak) => odznak.kurz).filter(Boolean))];

        return (
          <li key={kind} className="flex items-start gap-3" data-ziskany={ma ? "ano" : "ne"}>
            <span
              className={cn(
                "relative grid size-11 shrink-0 place-items-center rounded-full border-2",
                ma ? BARVA[kind] : "border-border bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              <span className="absolute inset-1 rounded-full border border-current opacity-30" />
              <Ikona className={cn("size-5", !ma && "opacity-60")} />
              {!ma && (
                <Lock className="bg-background text-muted-foreground absolute -right-1 -bottom-1 size-4 rounded-full p-0.5" />
              )}
            </span>
            <div className="min-w-0 text-sm">
              <p className={cn("font-medium", !ma && "text-muted-foreground")}>
                {POPIS_ODZNAKU[kind].nazev}
              </p>
              {ma ? (
                <>
                  {kurzy.length > 0 && (
                    <p className="text-muted-foreground text-xs break-words">{kurzy.join(", ")}</p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Získáno {formatDatum(ziskane[0]!.kdy)}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  <span className="sr-only">Zatím nezískaný. </span>
                  {POPIS_ODZNAKU[kind].jakZiskat}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
