"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";

import { objednej, overKod, type VysledekKodu } from "./actions";

/**
 * Okno nákupu jednoho produktu (Jakub, 20. 10. 2026): cena, nepovinný
 * slevový kód a Objednat. Po objednání jde klient rovnou na platbu —
 * na bránu, když je zapnutá, jinak na údaje k převodu.
 *
 * Objednat jde až se zaškrtnutým souhlasem s obchodními podmínkami
 * (Jakub, 20. 10. 2026) — včetně žádosti o zpřístupnění hned po zaplacení
 * a vědomí, že tím zaniká právo odstoupit. Server souhlas ověří znovu.
 */
export function KoupitProdukt({
  produkt,
  tlacitko,
  lzeZaplatit,
  otevrit,
}: {
  produkt: { id: string; nazev: string; cena: number; mena: string };
  tlacitko: "Koupit" | "Prodloužit";
  lzeZaplatit: boolean;
  otevrit: boolean;
}) {
  const router = useRouter();
  const [otevreno, setOtevreno] = useState(otevrit && lzeZaplatit);
  const [kod, setKod] = useState("");
  const [sleva, setSleva] = useState<Extract<VysledekKodu, { ok: true }> | null>(null);
  const [souhlas, setSouhlas] = useState(false);
  const [ceka, zahaj] = useTransition();

  const celkem = sleva?.celkem ?? produkt.cena;

  const pouzijKod = () =>
    zahaj(async () => {
      const vysledek = await overKod(produkt.id, kod);
      if (!vysledek.ok) {
        setSleva(null);
        toast.error(vysledek.chyba);
        return;
      }
      setSleva(vysledek);
      toast.success(`Kód ${vysledek.kod} platí.`);
    });

  const objednat = () =>
    zahaj(async () => {
      // Kód, který klient napsal, ale nepoužil, se pošle taky — server ho
      // ověří znovu a neplatný objednávku odmítne.
      const vysledek = await objednej(produkt.id, sleva?.kod ?? kod, souhlas);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      if (vysledek.odkazNaPlatbu) {
        window.location.assign(vysledek.odkazNaPlatbu);
        return;
      }
      toast.success(`Objednávka ${vysledek.cislo} je zapsaná.`);
      router.push(`/ucet/platba-prevodem?cislo=${encodeURIComponent(vysledek.cislo)}`);
    });

  return (
    <Dialog
      open={otevreno}
      onOpenChange={(stav) => {
        setOtevreno(stav);
        if (!stav) {
          setKod("");
          setSleva(null);
          setSouhlas(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={!lzeZaplatit} aria-label={`${tlacitko}: ${produkt.nazev}`}>
          <ShoppingBag />
          {tlacitko}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tlacitko === "Prodloužit" ? "Prodloužit" : "Koupit"}</DialogTitle>
          <DialogDescription>{produkt.nazev}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`kod-${produkt.id}`}>Slevový kód (nepovinné)</Label>
            <div className="flex gap-2">
              <Input
                id={`kod-${produkt.id}`}
                value={kod}
                maxLength={40}
                autoComplete="off"
                onChange={(udalost) => {
                  setKod(udalost.target.value);
                  setSleva(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={ceka || kod.trim() === ""}
                onClick={pouzijKod}
              >
                Použít
              </Button>
            </div>
          </div>

          <dl className="space-y-1 text-sm">
            {sleva && (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cena</dt>
                  <dd className="tabular">{formatMoney(sleva.celkemPredSlevou, produkt.mena)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Sleva ({sleva.kod})</dt>
                  <dd className="tabular">−{formatMoney(sleva.sleva, produkt.mena)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3 font-medium">
              <dt>K úhradě včetně DPH</dt>
              <dd className="tabular" data-testid="k-uhrade">
                {formatMoney(celkem, produkt.mena)}
              </dd>
            </div>
          </dl>

          <div className="flex items-start gap-3">
            <Checkbox
              id={`souhlas-${produkt.id}`}
              checked={souhlas}
              onCheckedChange={(stav) => setSouhlas(stav === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`souhlas-${produkt.id}`}
              className="text-muted-foreground block text-sm leading-snug font-normal"
            >
              Souhlasím s{" "}
              <a
                href="/ucet/obchodni-podminky"
                target="_blank"
                rel="noopener"
                className="text-foreground underline"
              >
                obchodními podmínkami
              </a>{" "}
              a žádám o zpřístupnění hned po zaplacení. Beru na vědomí, že zpřístupněním obsahu, u
              konzultace jejím uskutečněním, ztrácím právo od smlouvy odstoupit.
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOtevreno(false)}>
            Zrušit
          </Button>
          <Button type="button" disabled={ceka || !souhlas} onClick={objednat}>
            {ceka && <Loader2 className="animate-spin" />}
            Objednat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
