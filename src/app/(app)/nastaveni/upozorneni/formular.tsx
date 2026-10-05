"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { ulozUpozorneni } from "./actions";

export function FormularUpozorneni({ zapnuto }: { zapnuto: boolean }) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={(udalost) => {
        // `onSubmit`, ne `action` — formulář se po odmítnutí nevyprázdní.
        udalost.preventDefault();
        const data = new FormData(udalost.currentTarget);
        zahaj(async () => {
          const vysledek = await ulozUpozorneni(data);
          if (!vysledek.ok) {
            toast.error(vysledek.chyba);
            return;
          }
          toast.success(vysledek.zprava);
          router.refresh();
        });
      }}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="errorNotificationsEnabled"
          name="errorNotificationsEnabled"
          defaultChecked={zapnuto}
          className="mt-0.5"
        />
        <Label htmlFor="errorNotificationsEnabled" className="text-sm leading-relaxed font-normal">
          Posílat administrátorům e-mail, když v SmartEmailing → Chyby přibude nová chyba
        </Label>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit
      </Button>
    </form>
  );
}
