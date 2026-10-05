"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Merge, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pocet } from "@/lib/mnozne";

import { prejmenujZdroj, prepniZdroj, slucZdroje, zalozZdroj, type Vysledek } from "./actions";

export interface ZdrojKeSprave {
  id: string;
  name: string;
  active: boolean;
  klientu: number;
}

/** Seznam zdrojů s přejmenováním, skrytím a sloučením; pod ním přidání nového. */
export function SpravaZdroju({ zdroje }: { zdroje: ZdrojKeSprave[] }) {
  return (
    <div className="space-y-6">
      <div className="divide-border divide-y">
        {zdroje.map((zdroj) => (
          <RadekZdroje
            key={zdroj.id}
            zdroj={zdroj}
            ostatni={zdroje.filter((jiny) => jiny.id !== zdroj.id)}
          />
        ))}
      </div>
      <NovyZdroj />
    </div>
  );
}

function RadekZdroje({ zdroj, ostatni }: { zdroj: ZdrojKeSprave; ostatni: ZdrojKeSprave[] }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  // Název žije ve stavu — po odmítnutí ze serveru se napsané neztratí.
  const [nazev, setNazev] = useState(zdroj.name);

  const proved = (akce: () => Promise<Vysledek>) =>
    zahaj(async () => {
      const vysledek = await akce();
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
      {/* Na telefonu má název s Uložit celý řádek a zbytek jde pod něj
          (26. 9. 2026) — vedle sebe se to překrývalo. */}
      <form
        method="post"
        className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1"
        onSubmit={(udalost) => {
          udalost.preventDefault();
          const data = new FormData(udalost.currentTarget);
          proved(() => prejmenujZdroj(data));
        }}
      >
        <input type="hidden" name="id" value={zdroj.id} />
        <Input
          name="name"
          value={nazev}
          onChange={(udalost) => setNazev(udalost.target.value)}
          maxLength={60}
          aria-label={`Název zdroje ${zdroj.name}`}
          className="min-w-0 flex-1 sm:min-w-[10rem]"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={ceka || nazev.trim() === zdroj.name}
        >
          Uložit
        </Button>
      </form>

      <span className="text-muted-foreground tabular mr-auto text-xs sm:mr-0 sm:w-24 sm:text-right">
        {pocet(zdroj.klientu, "klient", "klienti", "klientů")}
      </span>
      {!zdroj.active && <Badge variant="secondary">Skrytý</Badge>}

      <Button
        variant="ghost"
        size="sm"
        disabled={ceka}
        onClick={() => proved(() => prepniZdroj(zdroj.id, !zdroj.active))}
      >
        {ceka && <Loader2 className="animate-spin" />}
        {zdroj.active ? "Skrýt" : "Znovu nabízet"}
      </Button>

      {ostatni.length > 0 && <SlouceniZdroje zdroj={zdroj} ostatni={ostatni} />}
    </div>
  );
}

/**
 * Sloučení zdroje do jiného — typicky „FB" do „Facebook".
 *
 * Nejde vzít zpět, proto potvrzovací okno (stejná pravidla jako u mazání):
 * co se stane jménem, kolik klientů se přesune a že to nejde vrátit.
 * Při odmítnutí ze serveru okno zůstane otevřené.
 */
function SlouceniZdroje({ zdroj, ostatni }: { zdroj: ZdrojKeSprave; ostatni: ZdrojKeSprave[] }) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [cil, setCil] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  const nazevCile = ostatni.find((jiny) => jiny.id === cil)?.name;

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) {
          setChyba(null);
          setCil("");
        }
      }}
    >
      <Button variant="ghost" size="sm" onClick={() => setOtevreno(true)}>
        <Merge />
        Sloučit…
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sloučit zdroj {zdroj.name}</DialogTitle>
          <DialogDescription>
            {pocet(zdroj.klientu, "klient", "klienti", "klientů")} se zdrojem {zdroj.name} dostane
            vybraný zdroj a {zdroj.name} se skryje. <strong>Sloučení nejde vzít zpět.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 space-y-3">
          {chyba && (
            <Alert variant="destructive">
              <AlertDescription>{chyba}</AlertDescription>
            </Alert>
          )}
          <Select value={cil} onValueChange={setCil}>
            <SelectTrigger className="w-full" aria-label="Do kterého zdroje sloučit">
              <SelectValue placeholder="Do kterého zdroje sloučit" />
            </SelectTrigger>
            <SelectContent>
              {ostatni.map((jiny) => (
                <SelectItem key={jiny.id} value={jiny.id}>
                  {jiny.name}
                  {!jiny.active && " (skrytý)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
            Zrušit
          </Button>
          <Button
            variant="destructive"
            disabled={ceka || !cil}
            onClick={() =>
              zahaj(async () => {
                setChyba(null);
                const vysledek = await slucZdroje(zdroj.id, cil);
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
            {nazevCile ? `Sloučit do ${nazevCile}` : "Sloučit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovyZdroj() {
  const router = useRouter();
  const [nazev, setNazev] = useState("");
  const [ceka, zahaj] = useTransition();

  return (
    <form
      method="post"
      className="flex flex-wrap items-center gap-2 border-t pt-4"
      onSubmit={(udalost) => {
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await zalozZdroj(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          setNazev("");
          router.refresh();
        });
      }}
    >
      <Input
        name="name"
        value={nazev}
        onChange={(udalost) => setNazev(udalost.target.value)}
        maxLength={60}
        placeholder="Nový zdroj, třeba TikTok"
        aria-label="Název nového zdroje"
        className="min-w-[12rem] flex-1"
      />
      <Button type="submit" disabled={ceka || nazev.trim().length < 2}>
        {ceka ? <Loader2 className="animate-spin" /> : <Plus />}
        Přidat zdroj
      </Button>
    </form>
  );
}
