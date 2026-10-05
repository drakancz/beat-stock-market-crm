import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "@/lib/types";
import type { ClientStage } from "@/generated/prisma/enums";

/**
 * Stav klienta v obchodním procesu.
 *
 * Odlišuje se sytostí, ne barvou — zelená a červená patří výhradně zisku
 * a ztrátě a jinde se nepoužívají.
 */
const STAGE_CLASS: Record<ClientStage, string> = {
  NOVY: "bg-muted text-muted-foreground border-border",
  KONTAKTOVAN: "bg-muted text-foreground border-border",
  MA_ZAJEM: "bg-accent text-accent-foreground border-transparent",
  MA_UCET: "bg-accent text-accent-foreground border-transparent",
  AKTIVNE_OBCHODUJE: "bg-primary text-primary-foreground border-transparent",
  NEAKTIVNI: "bg-transparent text-muted-foreground border-border border-dashed",
};

export function StageBadge({ stage, className }: { stage: ClientStage; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STAGE_CLASS[stage], className)}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}
