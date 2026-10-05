"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, TriangleAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Formulář lekce i článku členské sekce (krok 3C): název, text a video.
 * Uložení dělá serverová akce předaná zvenku (`ulozLekci`, `ulozClanek`),
 * ta si ověří roli i vstup.
 *
 * Upozornění na pravidlo 9 je tu schválně: obsah pro klienty nesmí
 * vypadat jako investiční doporučení.
 */
export function ObsahDialog({
  druh,
  skryte,
  obsah,
  ulozit,
  sezverejnenim,
}: {
  /** „lekce" nebo „článek" — do nadpisů a tlačítek. */
  druh: "lekce" | "článek";
  /** Skrytá pole formuláře (id kurzu, id záznamu). */
  skryte: Record<string, string>;
  obsah?: { title: string; body: string; videoUrl: string; zverejneno?: boolean };
  ulozit: (
    formData: FormData,
  ) => Promise<{ ok: true; zprava: string } | { ok: false; chyba: string }>;
  /** Článek má volbu Koncept / Zveřejněno, lekce ne (řídí ji kurz). */
  sezverejnenim?: boolean;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();
  const novy = !obsah;
  const nadpis = novy
    ? druh === "lekce"
      ? "Nová lekce"
      : "Nový článek"
    : druh === "lekce"
      ? "Upravit lekci"
      : "Upravit článek";
  const idFormulare = `obsah-${druh === "lekce" ? "lekce" : "clanek"}-${skryte.id ?? "novy"}`;

  return (
    <>
      {novy ? (
        <Button onClick={() => setOtevreno(true)}>
          <Plus />
          {nadpis}
        </Button>
      ) : (
        <Button variant="ghost" size="icon" title={nadpis} onClick={() => setOtevreno(true)}>
          <Pencil />
          <span className="sr-only">
            {nadpis}: {obsah.title}
          </span>
        </Button>
      )}

      <Dialog
        open={otevreno}
        onOpenChange={(stav) => {
          setOtevreno(stav);
          if (!stav) setChyba(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{nadpis}</DialogTitle>
            <DialogDescription>
              Text je prostý — odstavce odděl prázdným řádkem. Video vlož jako odkaz na YouTube nebo
              Vimeo (neveřejné video stačí).
            </DialogDescription>
          </DialogHeader>

          <form
            id={idFormulare}
            onSubmit={(udalost) => {
              udalost.preventDefault();
              // Ne `action`: React by po odmítnutí ze serveru vyprázdnil vyplněná pole.
              const formData = new FormData(udalost.currentTarget);
              zahaj(async () => {
                setChyba(null);
                const vysledek = await ulozit(formData);
                if (!vysledek.ok) {
                  setChyba(vysledek.chyba);
                  return;
                }
                toast.success(vysledek.zprava);
                setOtevreno(false);
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            {chyba && (
              <Alert variant="destructive">
                <AlertDescription>{chyba}</AlertDescription>
              </Alert>
            )}
            {Object.entries(skryte).map(([nazev, hodnota]) => (
              <input key={nazev} type="hidden" name={nazev} value={hodnota} />
            ))}

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-title`}>Název</Label>
              <Input
                id={`${idFormulare}-title`}
                name="title"
                defaultValue={obsah?.title}
                required
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-video`}>Video (nepovinné)</Label>
              <Input
                id={`${idFormulare}-video`}
                name="videoUrl"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                defaultValue={obsah?.videoUrl}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idFormulare}-body`}>Text</Label>
              <Textarea
                id={`${idFormulare}-body`}
                name="body"
                defaultValue={obsah?.body}
                rows={12}
                maxLength={50_000}
              />
            </div>

            {sezverejnenim && (
              <div
                role="radiogroup"
                aria-label="Vidí ho klienti?"
                className="flex flex-wrap gap-x-6 gap-y-2"
              >
                {(
                  [
                    ["ne", "Koncept — zatím ne"],
                    ["ano", "Zveřejněno"],
                  ] as const
                ).map(([volba, popisek]) => (
                  <label key={volba} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="zverejnit"
                      value={volba}
                      required
                      defaultChecked={(obsah?.zverejneno ? "ano" : "ne") === volba}
                      className="accent-primary size-4"
                    />
                    {popisek}
                  </label>
                ))}
              </div>
            )}

            <Alert>
              <TriangleAlert />
              <AlertDescription className="text-xs leading-relaxed">
                Obsah pro klienty nesmí vypadat jako investiční doporučení (kupte, prodejte,
                konkrétní cíle) — na to je potřeba licence. Vzdělávání ano, rady k obchodům ne.
              </AlertDescription>
            </Alert>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOtevreno(false)}>
              Zrušit
            </Button>
            <Button type="submit" form={idFormulare} disabled={ceka}>
              {ceka && <Loader2 className="animate-spin" />}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
