"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { nactiOdhlasene } from "./actions";

/** Zeptá se SmartEmailingu na odhlášené a v CRM jim odebere souhlas. */
export function NacistOdhlasene({ seznamVybrany }: { seznamVybrany: boolean }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={ceka || !seznamVybrany}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await nactiOdhlasene();
          if (vysledek.ok) toast.success(vysledek.zprava);
          else toast.error(vysledek.chyba);
          router.refresh();
        })
      }
    >
      {ceka ? <Loader2 className="animate-spin" /> : <UserMinus />}
      Načíst odhlášené
    </Button>
  );
}
