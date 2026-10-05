"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/lib/types";
import type { OrderStatus } from "@/generated/prisma/enums";

import { zmenStavObjednavky } from "./actions";

/**
 * Stav objednávky — výběr pro administrátora, jinak jen popisek.
 *
 * Přepínat stav smí **jen administrátor** (Jakub, 22. 9. 2026); ostatní
 * vidí, kde objednávka stojí, ale nesáhnou na ni. Skrytý výběr je úklid,
 * ne ochrana — rozhoduje `requireAdmin()` v serverové akci.
 *
 * Až bude platební brána, bude stav nastavovat ona.
 */
export function StavObjednavky({
  objednavka,
  smiMenit,
}: {
  objednavka: { id: string; status: OrderStatus };
  smiMenit: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  if (!smiMenit) {
    return (
      <Badge variant={objednavka.status === "ZAPLACENO" ? "default" : "outline"}>
        {ORDER_STATUS_LABEL[objednavka.status]}
      </Badge>
    );
  }

  return (
    <Select
      value={objednavka.status}
      disabled={ceka}
      onValueChange={(stav) =>
        zahaj(async () => {
          const vysledek = await zmenStavObjednavky(objednavka.id, stav);

          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }

          toast.success(vysledek.zprava);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-40" aria-label="Změnit stav objednávky">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ORDER_STATUSES.map((stav) => (
          <SelectItem key={stav.id} value={stav.id}>
            {stav.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
