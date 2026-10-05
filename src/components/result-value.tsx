import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/format";

/**
 * Zisk nebo ztráta. Jediné místo v systému, kde se používá zelená a červená.
 *
 * Barva nikdy nenese informaci sama o sobě — znaménko je vždy i v textu,
 * aby to fungovalo i pro barvoslepé.
 */
export function ResultValue({
  absolute,
  percent,
  currency,
  className,
  showPercentOnly = false,
}: {
  absolute: number;
  percent: number;
  currency?: string;
  className?: string;
  showPercentOnly?: boolean;
}) {
  const tone = absolute > 0 ? "text-profit" : absolute < 0 ? "text-loss" : "text-muted-foreground";

  return (
    <span className={cn("tabular font-medium whitespace-nowrap", tone, className)}>
      {showPercentOnly || !currency ? (
        formatPercent(percent)
      ) : (
        <>
          {formatMoney(absolute, currency, { signed: true })}
          <span className="text-muted-foreground/80 ml-2 text-[0.9em]">
            {formatPercent(percent)}
          </span>
        </>
      )}
    </span>
  );
}
