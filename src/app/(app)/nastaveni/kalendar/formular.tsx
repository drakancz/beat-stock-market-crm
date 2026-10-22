"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarSync, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ulozKalendar, vyzkousej, zapisBudouci, type VysledekKalendare } from "./actions";

/**
 * Napojení na Google Kalendář — jen administrátor (hlídají akce).
 *
 * `onSubmit` místo `action`: React po odeslání přes `action` formulář
 * sám vyprázdní a po odmítnutí ze serveru by člověk psal všechno znovu.
 */
export function FormularKalendare({
  kalendar,
  zapnuto,
  maKlic,
}: {
  kalendar: string | null;
  zapnuto: boolean;
  maKlic: boolean;
}) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const proved = (akce: () => Promise<VysledekKalendare>) =>
    zahaj(async () => {
      const vysledek = await akce();
      if (vysledek.ok) toast.success(vysledek.zprava);
      else toast.error(vysledek.chyba);
      router.refresh();
    });

  const onSubmit = (udalost: React.SubmitEvent<HTMLFormElement>) => {
    udalost.preventDefault();
    const data = new FormData(udalost.currentTarget);
    proved(() => ulozKalendar(data));
  };

  return (
    <div className="space-y-6">
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="googleCalendarId">ID firemního kalendáře</Label>
          <Input
            id="googleCalendarId"
            name="googleCalendarId"
            defaultValue={kalendar ?? ""}
            maxLength={200}
            placeholder="firma@gmail.com"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            U hlavního kalendáře Gmailu je to adresa účtu. Najdeš ho v Google Kalendáři → Nastavení
            kalendáře → Integrovat kalendář.
          </p>
        </div>

        <div className="flex items-start gap-2.5">
          <Checkbox
            id="googleCalendarActive"
            name="googleCalendarActive"
            defaultChecked={zapnuto}
            disabled={!maKlic}
            className="mt-0.5"
          />
          <Label htmlFor="googleCalendarActive" className="text-sm leading-relaxed font-normal">
            Zapisovat rezervace konzultací do kalendáře
          </Label>
        </div>

        <Button type="submit" disabled={ceka}>
          {ceka && <Loader2 className="animate-spin" />}
          Uložit
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={ceka || !maKlic || !kalendar}
          onClick={() => proved(vyzkousej)}
        >
          <Send />
          Vyzkoušet spojení
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={ceka || !zapnuto}
          onClick={() => proved(zapisBudouci)}
        >
          <CalendarSync />
          Zapsat budoucí rezervace
        </Button>
      </div>
    </div>
  );
}
