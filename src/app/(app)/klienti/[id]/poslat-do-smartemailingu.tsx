"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { posliKlientaDoSmartemailingu } from "../actions";

/**
 * Tlačítko Poslat do SmartEmailingu na kartě klienta (Jakub, 15. 9. 2026).
 *
 * Ukazuje se jen administrátorovi u klienta se souhlasem, když je propojení
 * zapnuté. Nic nechrání — roli si serverová akce ověřuje sama.
 */
export function PoslatDoSmartemailingu({ clientId, jmeno }: { clientId: string; jmeno: string }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full"
      disabled={ceka}
      aria-label={`Poslat do SmartEmailingu: ${jmeno}`}
      onClick={() =>
        zahaj(async () => {
          const vysledek = await posliKlientaDoSmartemailingu(clientId);
          if (vysledek.ok) toast.success(vysledek.zprava);
          else toast.error(vysledek.chyba);
          router.refresh();
        })
      }
    >
      {ceka ? <Loader2 className="animate-spin" /> : <Send />}
      Poslat do SmartEmailingu
    </Button>
  );
}
