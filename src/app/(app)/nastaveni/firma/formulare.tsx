"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { posliZkusebni, ulozEmaily, ulozFirmu, type Vysledek } from "./actions";

/** Víceřádkové pole ve stejném vzhledu jako `Input`. */
const TEXTAREA =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

/**
 * Odeslání bez vyprázdnění formuláře.
 *
 * `onSubmit` místo `action`: React po odeslání přes `action` formulář
 * sám vyprázdní a po odmítnutí ze serveru by člověk psal všechno znovu.
 */
function useOdeslani(akce: (data: FormData) => Promise<Vysledek>) {
  const router = useRouter();
  const [ceka, zahaj] = useTransition();

  const onSubmit = (udalost: React.SubmitEvent<HTMLFormElement>) => {
    udalost.preventDefault();
    const data = new FormData(udalost.currentTarget);
    zahaj(async () => {
      const vysledek = await akce(data);
      if (!vysledek.ok) {
        toast.error(vysledek.chyba);
        return;
      }
      toast.success(vysledek.zprava);
      router.refresh();
    });
  };

  return { ceka, onSubmit };
}

export interface UdajeFirmy {
  companyName: string;
  ico: string | null;
  dic: string | null;
  address: string | null;
  contactEmail: string | null;
  vatPayer: boolean;
}

export function FormularFirmy({ firma }: { firma: UdajeFirmy }) {
  const { ceka, onSubmit } = useOdeslani(ulozFirmu);

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="companyName">Název firmy</Label>
        <Input
          id="companyName"
          name="companyName"
          defaultValue={firma.companyName}
          maxLength={120}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ico">IČO</Label>
          <Input
            id="ico"
            name="ico"
            defaultValue={firma.ico ?? ""}
            inputMode="numeric"
            maxLength={10}
            placeholder="12345678"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dic">DIČ</Label>
          <Input
            id="dic"
            name="dic"
            defaultValue={firma.dic ?? ""}
            maxLength={14}
            placeholder="CZ12345678"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Sídlo</Label>
        <Input
          id="address"
          name="address"
          defaultValue={firma.address ?? ""}
          maxLength={200}
          placeholder="Ulice 1, 110 00 Praha"
        />
      </div>

      {/* Kontakt pro klienty (Jakub, 30. 9. 2026) — veřejně v zásadách
          ochrany osobních údajů a podmínkách klientské části. */}
      <div className="space-y-2">
        <Label htmlFor="contactEmail">Kontaktní e-mail pro klienty</Label>
        <Input
          id="contactEmail"
          name="contactEmail"
          type="email"
          defaultValue={firma.contactEmail ?? ""}
          maxLength={254}
          placeholder="info@beatstockmarket.cz"
        />
        <p className="text-muted-foreground text-xs">
          Ukáže se klientům v zásadách ochrany osobních údajů a v podmínkách — kam psát kvůli svým
          údajům a objednávkám.
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id="vatPayer"
          name="vatPayer"
          defaultChecked={firma.vatPayer}
          className="mt-0.5"
        />
        <Label htmlFor="vatPayer" className="text-sm leading-relaxed font-normal">
          Firma je plátce DPH
        </Label>
      </div>

      <Button type="submit" disabled={ceka}>
        {ceka && <Loader2 className="animate-spin" />}
        Uložit údaje firmy
      </Button>
    </form>
  );
}

export function FormularEmailu({
  jmenoOdesilatele,
  podpis,
}: {
  jmenoOdesilatele: string | null;
  podpis: string | null;
}) {
  const { ceka, onSubmit } = useOdeslani(ulozEmaily);
  const zkouska = useOdeslani(() => posliZkusebni());

  return (
    <div className="space-y-4">
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="emailSenderName">Jméno odesílatele</Label>
          <Input
            id="emailSenderName"
            name="emailSenderName"
            defaultValue={jmenoOdesilatele ?? ""}
            maxLength={80}
            placeholder="Beat Stock Market"
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Co příjemce uvidí v poli Od. Adresa se nemění — musí sedět s ověřenou doménou.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="emailSignature">Podpis pod zprávou</Label>
          <textarea
            id="emailSignature"
            name="emailSignature"
            defaultValue={podpis ?? ""}
            maxLength={1000}
            rows={4}
            placeholder={"Tým Beat Stock Market\n+420 601 234 567"}
            className={cn(TEXTAREA)}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Prostý text, řádky se zachovají. Objeví se v pozvánce, obnově hesla i uvítání.
          </p>
        </div>

        <Button type="submit" disabled={ceka}>
          {ceka && <Loader2 className="animate-spin" />}
          Uložit e-maily
        </Button>
      </form>

      <form method="post" onSubmit={zkouska.onSubmit} className="border-t pt-4">
        <Button type="submit" variant="outline" disabled={zkouska.ceka}>
          {zkouska.ceka ? <Loader2 className="animate-spin" /> : <Send />}
          Poslat si zkušební e-mail
        </Button>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          Přijde na tvoji adresu s uloženým jménem odesílatele, podpisem i údaji firmy.
        </p>
      </form>
    </div>
  );
}
