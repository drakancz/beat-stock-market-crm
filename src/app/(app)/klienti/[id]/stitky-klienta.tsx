"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Stitek } from "@/components/stitky/stitek";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TagColor } from "@/generated/prisma/enums";

import { nastavStitekKlientum } from "../stitky-actions";

type StitekVolba = { id: string; name: string; color: TagColor };

/**
 * Štítky na kartě klienta (Fáze 5B, Jakub 11. 10. 2026). **Přidat
 * i odebrat smí každý přihlášený**; seznam štítků spravuje administrátor
 * v Nastavení. Odebrání má potvrzovací okno. Klient štítky nevidí.
 */
export function StitkyKlienta({
  klientId,
  klientJmeno,
  maji,
  vsechny,
}: {
  klientId: string;
  klientJmeno: string;
  maji: StitekVolba[];
  vsechny: StitekVolba[];
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();
  const [nabidka, setNabidka] = useState(false);
  const [odebrat, setOdebrat] = useState<StitekVolba | null>(null);
  const nemaji = vsechny.filter((s) => !maji.some((m) => m.id === s.id));

  function zmen(stitek: StitekVolba, pridat: boolean, poUspechu?: () => void) {
    zahaj(async () => {
      const vysledek = await nastavStitekKlientum([klientId], stitek.id, pridat);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      poUspechu?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Štítky klienta" role="group">
      {maji.length === 0 && <span className="text-muted-foreground text-sm">Bez štítků</span>}
      {maji.map((stitek) => (
        <Stitek key={stitek.id} nazev={stitek.name} barva={stitek.color} className="pr-0.5">
          <button
            type="button"
            onClick={() => setOdebrat(stitek)}
            className="hover:bg-foreground/10 rounded-full p-0.5"
            title="Odebrat štítek"
          >
            <X className="size-3" />
            <span className="sr-only">Odebrat štítek {stitek.name}</span>
          </button>
        </Stitek>
      ))}

      {nemaji.length > 0 && (
        <Popover open={nabidka} onOpenChange={setNabidka}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={ceka}>
              {ceka ? <Loader2 className="animate-spin" /> : <Plus />}
              Přidat štítek
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-72">
            <ul className="flex flex-wrap gap-1.5" aria-label="Nabídka štítků">
              {nemaji.map((stitek) => (
                <li key={stitek.id}>
                  <button
                    type="button"
                    onClick={() => zmen(stitek, true, () => setNabidka(false))}
                    className="rounded-full"
                  >
                    <Stitek nazev={stitek.name} barva={stitek.color} className="cursor-pointer" />
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={odebrat !== null} onOpenChange={(stav) => !stav && setOdebrat(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odebrat štítek</DialogTitle>
            <DialogDescription>
              Opravdu odebrat štítek {odebrat?.name} — klient: {klientJmeno}?{" "}
              <strong>Tuhle akci nelze vzít zpět</strong>, štítek jde jen znovu přidat.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOdebrat(null)}>
              Zrušit
            </Button>
            <Button
              variant="destructive"
              disabled={ceka}
              onClick={() => odebrat && zmen(odebrat, false, () => setOdebrat(null))}
            >
              {ceka && <Loader2 className="animate-spin" />}
              Odebrat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
