"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
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

import { smazUkol } from "./ukoly-actions";

/**
 * Potvrzení smazání úkolu.
 *
 * **Každá mazací akce v systému má potvrzovací okno** (CLAUDE.md).
 *
 * Text mluví o nenávratném smazání, i když se řádek ve skutečnosti jen
 * označí jako smazaný. Je to stejné rozhodnutí jako u hovorů (Jakub,
 * 6. 9. 2026): kdo maže, má to dělat s vědomím, že je to napořád.
 * Slovo „koš" se tu proto neobjeví — a úkoly do obrazovky Smazané ani
 * nechodí, vrátit je nejde.
 *
 * Okno je pohodlí, ne ochrana — nárok si serverová akce ověřuje sama.
 */
export function SmazaniUkolu({ ukol }: { ukol: { id: string; title: string } }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [ceka, zahaj] = useTransition();

  return (
    <Dialog open={otevreno} onOpenChange={setOtevreno}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOtevreno(true)}
        aria-label={`Smazat úkol ${ukol.title}`}
        title="Smazat úkol"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Smazat úkol</DialogTitle>
          <DialogDescription>
            Opravdu smazat úkol „{ukol.title}&ldquo;? <strong>Tuhle akci nelze vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        <Alert className="my-2">
          <AlertDescription className="text-xs leading-relaxed">
            Úkol zmizí ze seznamu na Dashboardu. Hotový úkol není potřeba mazat — stačí ho
            odškrtnout a v seznamu čekajících se přestane ukazovat.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOtevreno(false)}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() =>
              zahaj(async () => {
                const vysledek = await smazUkol(ukol.id);

                if (!vysledek.ok) {
                  // Okno zůstane otevřené — ať je vidět, čeho se odmítnutí týká.
                  toast.error(vysledek.chyba);
                  return;
                }

                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
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
