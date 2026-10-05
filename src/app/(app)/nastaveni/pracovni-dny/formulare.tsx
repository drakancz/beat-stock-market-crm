"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DNY_V_TYDNU } from "@/lib/svatky";

import { pridejVolno, ulozPracovniDny, zrusVolno, type Vysledek } from "./actions";

/** Odeslání přes `onSubmit` — formulář se po odmítnutí ze serveru nevyprázdní. */
function useFormular(akce: (data: FormData) => Promise<Vysledek>, poUspechu?: () => void) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const onSubmit = (udalost: React.SubmitEvent<HTMLFormElement>) => {
    udalost.preventDefault();
    const formular = udalost.currentTarget;
    const data = new FormData(formular);
    zahaj(async () => {
      const vysledek = await akce(data);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      poUspechu?.();
      formular.reset();
      router.refresh();
    });
  };

  return { ceka, onSubmit };
}

export function FormularDnu({ dny }: { dny: number[] }) {
  const { ceka, onSubmit } = useFormular(ulozPracovniDny);

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <fieldset className="flex flex-wrap gap-x-5 gap-y-3">
        <legend className="sr-only">Pracovní dny v týdnu</legend>
        {DNY_V_TYDNU.map((den) => (
          <div key={den.cislo} className="flex items-center gap-2">
            <Checkbox
              id={`den-${den.cislo}`}
              name="den"
              value={String(den.cislo)}
              defaultChecked={dny.includes(den.cislo)}
            />
            <Label htmlFor={`den-${den.cislo}`} className="font-normal capitalize">
              {den.nazev}
            </Label>
          </div>
        ))}
      </fieldset>
      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit pracovní dny
      </Button>
    </form>
  );
}

export function NoveVolno() {
  const { ceka, onSubmit } = useFormular(pridejVolno);

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="datum">Den</Label>
        <Input id="datum" name="datum" type="date" required className="w-auto" />
      </div>
      <div className="min-w-[14rem] flex-1 space-y-2">
        <Label htmlFor="nazev-volna">Proč je volno</Label>
        <Input
          id="nazev-volna"
          name="name"
          required
          maxLength={80}
          placeholder="Firemní dovolená"
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={ceka}>
        {ceka ? <Loader2 className="animate-spin" /> : <Plus />}
        Přidat volno
      </Button>
    </form>
  );
}

/**
 * Zrušení volna — potvrzovací okno jako u každého mazání: co se ruší
 * jménem, že to nejde vzít zpět, okno zůstane otevřené při odmítnutí.
 */
export function ZruseniVolna({ volno }: { volno: { id: string; name: string; datum: string } }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) setChyba(null);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOtevreno(true)}
        aria-label={`Odstranit volno ${volno.name}`}
        title="Odstranit"
      >
        <Trash2 />
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Odstranit volno {volno.name}</DialogTitle>
          <DialogDescription>
            {volno.datum} pak bude zase pracovní den. <strong>Nejde to vzít zpět</strong> — volno
            můžeš jen přidat znovu.
          </DialogDescription>
        </DialogHeader>

        {chyba && (
          <Alert variant="destructive">
            <AlertDescription>{chyba}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka}
            onClick={() =>
              zahaj(async () => {
                setChyba(null);
                const vysledek = await zrusVolno(volno.id);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
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
            Odstranit volno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
