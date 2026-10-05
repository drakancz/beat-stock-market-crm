"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { smazProdukt } from "./actions";

/**
 * Potvrzení smazání produktu z ceníku (Jakub, 27. 9. 2026).
 *
 * **Každá mazací akce v systému má potvrzovací okno** (CLAUDE.md). Text
 * mluví o nenávratném smazání, i když produkt jde do Smazaných — stejně
 * jako u brokerů a klientů: kdo maže, má to dělat s vědomím, že je to
 * napořád. Vrácení je záchranná brzda administrátora.
 *
 * Smazat jde i prodaný produkt; okno jen řekne, že objednávky ho dál
 * ukazují. Oprávnění hlídá `smazProdukt()` na serveru.
 */
export function SmazaniProduktu({
  produkt,
  zavrit,
  hotovo,
}: {
  produkt: { id: string; name: string; prodano: number } | null;
  zavrit: () => void;
  hotovo: () => void;
}) {
  const [ceka, zahaj] = useTransition();

  return (
    <Dialog open={produkt !== null} onOpenChange={(stav) => !stav && zavrit()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat produkt</DialogTitle>
          <DialogDescription>
            Opravdu smazat {produkt?.name}? Zmizí z ceníku, z nabídky i z příjmu objednávek z
            Landing Page — objednávka na něj se odmítne jako na neznámý produkt.{" "}
            <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        {produkt && produkt.prodano > 0 && (
          <Alert className="my-4">
            <AlertDescription className="text-xs leading-relaxed">
              Pozor: v zaplacených objednávkách je <strong>{produkt.prodano} ks</strong>.
              Objednávky, platnost členství i tržby ho dál ukazují — jen se přestane nabízet.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={zavrit}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() =>
              produkt &&
              zahaj(async () => {
                const vysledek = await smazProdukt(produkt.id);

                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                  toast.error(vysledek.chyba);
                  return;
                }

                toast.success(vysledek.zprava);
                hotovo();
              })
            }
          >
            {ceka && <Loader2 className="animate-spin" />}
            Smazat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
