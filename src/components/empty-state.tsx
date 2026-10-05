import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Prázdný stav — obrazovka je připravená, jen v ní zatím nic není. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border/80 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? <Icon className="text-muted-foreground/60 size-8" aria-hidden /> : null}
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold">{title}</p>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-md text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
