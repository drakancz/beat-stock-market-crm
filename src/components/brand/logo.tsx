import { cn } from "@/lib/utils";

/**
 * Značka: tep, který se zlomí do růstu (Jakub vybral 22. 9. 2026 ze čtyř
 * návrhů na téma graf).
 *
 * Vlevo slabší tep — **beat** ze jména firmy — vpravo silný vzestup se
 * šipkou. Dvě síly čáry dělají hloubku, aby značka nevypadala jako ikona
 * vytažená z knihovny.
 *
 * Kreslí se `currentColor`, takže se obarví podle místa, kde stojí, a sedí
 * ve světlém i tmavém režimu. **Rámeček tady není schválně** — v menu by
 * ubíral místo samotné křivce. Verze s rámečkem je v `src/app/icon.svg`
 * pro záložku prohlížeče, kde je rám v malém čitelnější.
 *
 * Tvar je i v `public/znacka-email.png` (do e-mailů SVG nejde).
 * **Při změně tvaru se musí přegenerovat i ono** — postup je v CLAUDE.md.
 */
export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    /*
     * Výřez je těsně kolem kresby, ne celé pole 64×64. Značka je široká
     * a nízká — ve čtverci by zabrala jen pruh uprostřed a působila by
     * drobně (viděno 22. 9. 2026 na přihlašovací stránce). Proto se
     * zadává jen šířka a výška se dopočítá z poměru stran.
     */
    <svg
      viewBox="3 14 58 31"
      role="img"
      aria-label="Beat Stock Market"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-9", className)}
      {...props}
    >
      {/* Tep: slabší, drží se vzadu */}
      <path d="M5 36h7l4-10 5.5 20L27 22l4 14h5" strokeWidth="4.5" strokeOpacity="0.45" />
      {/* Vzestup se šipkou */}
      <path d="M36 36l7-8 5 5 10-16" />
      <path d="M49 17h9v9" />
    </svg>
  );
}

/** Logo se jménem značky a popiskem. */
export function LogoLockup({
  subtitle = "interní systém",
  className,
}: {
  subtitle?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <LogoMark className="w-10 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-heading truncate text-[13px] font-bold tracking-wide">
          BEAT STOCK MARKET
        </span>
        <span className="text-muted-foreground mt-1 truncate font-mono text-[9.5px] tracking-[0.22em] uppercase">
          {subtitle}
        </span>
      </span>
    </span>
  );
}
