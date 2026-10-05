"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ulozCile } from "./actions";

export interface RadekCile {
  userId: string | null;
  name: string;
  castka: number;
  /** Popis měsíce, od kterého cíl platí, když je zděděný z dřívějška. */
  zdedenoZ: string | null;
}

export function FormularCilu({ mesic, radky }: { mesic: string; radky: RadekCile[] }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozCile(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="mesic" value={mesic} />

      <div className="divide-border divide-y">
        {radky.map((radek) => {
          const id = `cil-${radek.userId ?? "tym"}`;

          return (
            <div
              key={radek.userId ?? "tym"}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <label htmlFor={id} className="min-w-[12rem] flex-1 text-sm font-medium">
                {radek.name}
                <span className="text-muted-foreground block text-xs font-normal">
                  {radek.castka === 0
                    ? "bez cíle"
                    : radek.zdedenoZ
                      ? `platí od: ${radek.zdedenoZ}`
                      : "nastaveno pro tento měsíc"}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  name={`cil:${radek.userId ?? "tym"}`}
                  defaultValue={radek.castka > 0 ? String(radek.castka).replace(".", ",") : ""}
                  inputMode="decimal"
                  maxLength={16}
                  placeholder="bez cíle"
                  className="tabular w-40 text-right"
                  autoComplete="off"
                />
                <span className="text-muted-foreground text-sm">Kč</span>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit cíle
      </Button>
    </form>
  );
}
