import type { TagColor } from "@/generated/prisma/enums";
import { BARVY_STITKU } from "@/lib/stitky-barvy";
import { cn } from "@/lib/utils";

/** Značka štítku u klienta (Fáze 5B). */
export function Stitek({
  nazev,
  barva,
  className,
  children,
}: {
  nazev: string;
  barva: TagColor;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        BARVY_STITKU[barva].tridy,
        className,
      )}
    >
      <span className="truncate">{nazev}</span>
      {children}
    </span>
  );
}
