"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bezDph, castkaDph, popisSazby, sDph } from "@/lib/dph";
import { formatMoney } from "@/lib/format";
import { BEZ_PLATNOSTI, PRODUCT_KIND_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProductKind } from "@/generated/prisma/enums";

import { upravProdukt, zalozProdukt } from "./actions";
import { MENA_CENIKU, NABIDKA_PRODUKTU } from "./nabidka";
import { SmazaniProduktu } from "./smazani-produktu";

const DRUHY: ProductKind[] = ["KURZ", "CLENSTVI", "KONZULTACE"];

/** Sazba DPH k výběru. Výše v procentech (`21`). */
export interface SazbaKVyberu {
  id: string;
  name: string;
  rate: number;
}

/** Uložený produkt, který se v dialogu upravuje. */
export interface ProduktKUprave {
  id: string;
  name: string;
  kind: ProductKind;
  cenaBezDph: number;
  sazbaId: string;
  active: boolean;
  /** Odkaz na stránku produktu, nebo `null`. */
  url: string | null;
  /** Platnost v měsících, nebo `null` = neomezeno. */
  validityMonths: number | null;
  /** Kusy v zaplacených objednávkách — ukáže se v potvrzení smazání. */
  prodano: number;
}

/** Cena do políčka tak, jak ji píše člověk: s čárkou, prázdná místo nuly. */
const doPolicka = (castka: number) => (castka > 0 ? String(castka).replace(".", ",") : "");

/** Uložená cena produktu s DPH — tou se políčko při úpravě předvyplní. */
function ulozenaSDph(produkt: ProduktKUprave | undefined, sazby: SazbaKVyberu[]): number {
  if (!produkt) return 0;
  const sazba = sazby.find((polozka) => polozka.id === produkt.sazbaId);
  return sazba ? sDph(produkt.cenaBezDph, sazba.rate) : produkt.cenaBezDph;
}

/**
 * Založení nebo úprava produktu v ceníku.
 *
 * Bez `produkt` zakládá, s ním upravuje (Jakub, 10. 9. 2026). Název se dá
 * **vybrat z nabídky i celý napsat** — nabídka je jen zkratka k tomu, co
 * se zakládá nejčastěji, ne uzavřený seznam. Když se vybere z nabídky,
 * předvyplní se k němu i druh; napsaný název druh nemění, ten si člověk
 * vybere sám.
 *
 * Tlačítka vidí jen manažer a administrátor. Není to ochrana — serverové
 * akce si roli ověřují samy (security_warnings.md, pravidlo 5).
 */
export function ProduktDialog({
  sazby,
  produkt,
}: {
  sazby: SazbaKVyberu[];
  produkt?: ProduktKUprave;
}) {
  const router = useRouter();
  const vychoziSazba = sazby[0]?.id ?? "";

  const [otevreno, setOtevreno] = useState(false);
  // Potvrzení smazání je samostatné okno; úprava se před ním zavře.
  const [mazani, setMazani] = useState(false);
  const [chyba, setChyba] = useState<string | null>(null);
  const [ceka, zahaj] = useTransition();

  // Hodnoty žijí ve stavu dialogu, ne ve formuláři — po odmítnutí ze
  // serveru tak člověk nepřijde o to, co vyplnil.
  const [nazev, setNazev] = useState(produkt?.name ?? "");
  const [druh, setDruh] = useState<ProductKind>(produkt?.kind ?? "KURZ");
  // Cena se zadává s DPH (výchozí), nebo bez — Jakub, 27. 9. 2026.
  const [rezimCeny, setRezimCeny] = useState<"sDph" | "bezDph">("sDph");
  const [cena, setCena] = useState(doPolicka(ulozenaSDph(produkt, sazby)));
  const [sazbaId, setSazbaId] = useState(produkt?.sazbaId ?? vychoziSazba);
  const [stav, setStav] = useState(produkt && !produkt.active ? "neaktivni" : "v-prodeji");
  const [odkaz, setOdkaz] = useState(produkt?.url ?? "");
  const [platnost, setPlatnost] = useState(produkt?.validityMonths?.toString() ?? "");
  const [delka, setDelka] = useState<"neomezeno" | "mesice">(
    produkt?.validityMonths ? "mesice" : "neomezeno",
  );

  const sazba = sazby.find((polozka) => polozka.id === sazbaId);
  const bezPlatnosti = BEZ_PLATNOSTI[druh];

  const [nabidkaOtevrena, setNabidkaOtevrena] = useState(false);
  const [hledani, setHledani] = useState("");

  // Cena se píše česky (čárka, mezery mezi tisíci) — server to čte stejně.
  const zadanaCena = Number(cena.replace(/\s/g, "").replace(",", "."));

  const psanyNazev = hledani.trim();
  const jeVNabidce = NABIDKA_PRODUKTU.some(
    (polozka) => polozka.name.toLowerCase() === psanyNazev.toLowerCase(),
  );

  /**
   * Přepnutí s DPH / bez DPH přepočítá, co je v políčku — ať napsaná
   * částka po přepnutí znamená pořád totéž, ne jinou cenu.
   */
  function prepniRezim(novy: "sDph" | "bezDph") {
    if (novy === rezimCeny) return;
    if (zadanaCena > 0 && sazba) {
      setCena(
        doPolicka(novy === "sDph" ? sDph(zadanaCena, sazba.rate) : bezDph(zadanaCena, sazba.rate)),
      );
    }
    setRezimCeny(novy);
  }

  function vyberZNabidky(polozka: { name: string; kind: ProductKind }) {
    setNazev(polozka.name);
    setDruh(polozka.kind);
    setNabidkaOtevrena(false);
    setHledani("");
  }

  function pouzijPsany(text: string) {
    setNazev(text);
    setNabidkaOtevrena(false);
    setHledani("");
  }

  function otevri() {
    // Úprava začíná vždycky od toho, co je uložené — ne od toho, co
    // člověk minule rozepsal a zavřel.
    if (produkt) {
      setNazev(produkt.name);
      setDruh(produkt.kind);
      setRezimCeny("sDph");
      setCena(doPolicka(ulozenaSDph(produkt, sazby)));
      setSazbaId(produkt.sazbaId);
      setStav(produkt.active ? "v-prodeji" : "neaktivni");
      setOdkaz(produkt.url ?? "");
      setPlatnost(produkt.validityMonths?.toString() ?? "");
      setDelka(produkt.validityMonths ? "mesice" : "neomezeno");
    }
    setChyba(null);
    setOtevreno(true);
  }

  function zavri() {
    setOtevreno(false);
    setChyba(null);
  }

  return (
    <>
      <Dialog
        open={otevreno}
        onOpenChange={(otevrit) => {
          if (otevrit) otevri();
          else zavri();
        }}
      >
        {produkt ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={otevri}
            aria-label={`Upravit ${produkt.name}`}
            title="Upravit"
          >
            <Pencil />
          </Button>
        ) : (
          <Button onClick={otevri}>
            <Plus />
            Nový produkt
          </Button>
        )}

        {/* Na telefonu se okno posouvá — s odkazem na stránku už se nevejde. */}
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <form
            action={(formData) =>
              zahaj(async () => {
                setChyba(null);

                const vysledek = produkt
                  ? await upravProdukt(produkt.id, formData)
                  : await zalozProdukt(formData);

                if (!vysledek.ok) {
                  // Hláška se ukáže dvakrát: v dialogu u formuláře a jako
                  // upozornění v rohu. Text v dialogu se dá přehlédnout
                  // a člověk pak neví, proč se nic nestalo.
                  setChyba(vysledek.chyba);
                  toast.error(vysledek.chyba);
                  return;
                }

                toast.success(vysledek.zprava);
                if (!produkt) {
                  setNazev("");
                  setCena("");
                  setRezimCeny("sDph");
                  setSazbaId(vychoziSazba);
                  setDruh("KURZ");
                  setStav("v-prodeji");
                  setOdkaz("");
                  setPlatnost("");
                  setDelka("neomezeno");
                }
                zavri();
                router.refresh();
              })
            }
          >
            <DialogHeader>
              <DialogTitle>{produkt ? "Upravit produkt" : "Nový produkt"}</DialogTitle>
              <DialogDescription>
                {produkt
                  ? "Cenu zadáš s DPH, nebo bez — uloží se bez DPH. Změna ceny nebo sazby se projeví i u objednávek s tímto produktem — ceny se u objednávek nekopírují, berou se z ceníku."
                  : "Název vyber z nabídky, nebo si napiš vlastní. Cenu zadáš s DPH, nebo bez a hned uvidíš tu druhou."}
              </DialogDescription>
            </DialogHeader>

            <div className="my-5 space-y-4">
              {chyba && (
                <Alert variant="destructive">
                  <AlertDescription>{chyba}</AlertDescription>
                </Alert>
              )}

              {/*
              U úpravy je název obyčejné pole (Jakub, 27. 9. 2026) — přejmenovat
              přes výběr z nabídky šlo jen oklikou přes „Použít …“. Nabídka
              zůstává u zakládání, kde šetří psaní.
            */}
              {produkt ? (
                <div className="space-y-2">
                  <Label htmlFor="nazev">Název produktu</Label>
                  <Input
                    id="nazev"
                    name="name"
                    value={nazev}
                    onChange={(udalost) => setNazev(udalost.target.value)}
                    maxLength={120}
                    autoComplete="off"
                  />
                </div>
              ) : (
                <>
                  <input type="hidden" name="name" value={nazev} />

                  <div className="space-y-2">
                    <Label htmlFor="nazev">Název produktu</Label>
                    <Popover open={nabidkaOtevrena} onOpenChange={setNabidkaOtevrena}>
                      <PopoverTrigger asChild>
                        <Button
                          id="nazev"
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={nabidkaOtevrena}
                          aria-label="Vybrat nebo napsat název produktu"
                          className="w-full justify-between font-normal"
                        >
                          <span className={cn("truncate", !nazev && "text-muted-foreground")}>
                            {nazev || "Vyber z nabídky nebo napiš vlastní"}
                          </span>
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>

                      {/* Šířka podle tlačítka; `pointer-events-auto` kvůli tomu, že
                    popover leží uvnitř dialogu, který si jinak bere kliknutí. */}
                      <PopoverContent
                        className="pointer-events-auto w-(--radix-popover-trigger-width) p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput
                            placeholder="Hledat, nebo napsat vlastní název…"
                            value={hledani}
                            onValueChange={setHledani}
                          />
                          <CommandList>
                            <CommandEmpty>Napiš název a potvrď ho položkou nahoře.</CommandEmpty>

                            {/* Napsaný název, který v nabídce není. Hodnota položky
                          je ten samý text, takže ji hledání nikdy neodfiltruje. */}
                            {psanyNazev.length > 0 && !jeVNabidce && (
                              <CommandGroup heading="Vlastní název">
                                <CommandItem
                                  value={psanyNazev}
                                  onSelect={() => pouzijPsany(psanyNazev)}
                                >
                                  <Plus aria-hidden />
                                  Použít „{psanyNazev}&ldquo;
                                </CommandItem>
                              </CommandGroup>
                            )}

                            <CommandGroup heading="Nabídka">
                              {NABIDKA_PRODUKTU.map((polozka) => (
                                <CommandItem
                                  key={polozka.name}
                                  value={polozka.name}
                                  onSelect={() => vyberZNabidky(polozka)}
                                >
                                  <Check
                                    className={cn(
                                      nazev === polozka.name ? "opacity-100" : "opacity-0",
                                    )}
                                    aria-hidden
                                  />
                                  <span className="flex-1">{polozka.name}</span>
                                  <span className="text-muted-foreground text-xs">
                                    {PRODUCT_KIND_LABEL[polozka.kind]}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Nabídka je jen zkratka — název si můžeš napsat úplně vlastní.
                    </p>
                  </div>
                </>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="kind">Druh</Label>
                  <Select
                    name="kind"
                    value={druh}
                    onValueChange={(hodnota) => setDruh(hodnota as ProductKind)}
                  >
                    <SelectTrigger id="kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRUHY.map((polozka) => (
                        <SelectItem key={polozka} value={polozka}>
                          {PRODUCT_KIND_LABEL[polozka]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vatRateId">Sazba DPH</Label>
                  <Select name="vatRateId" value={sazbaId} onValueChange={setSazbaId}>
                    <SelectTrigger id="vatRateId" className="w-full">
                      <SelectValue placeholder="Vyber sazbu" />
                    </SelectTrigger>
                    <SelectContent>
                      {sazby.map((polozka) => (
                        <SelectItem key={polozka.id} value={polozka.id}>
                          {polozka.name} ({popisSazby(polozka.rate)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/*
                Cena s DPH, nebo bez (Jakub, 27. 9. 2026) — výchozí s DPH,
                protože tu zná zákazník. Ukládá se vždy bez DPH a přepočet
                dělá server; tady je jen náhled. Přepínače jsou obyčejné,
                ne rozbalovací Select — ten se po odeslání formuláře vracel
                na výchozí hodnotu.
              */}
              <div className="space-y-2">
                <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <legend className="sr-only">Zadaná cena je</legend>
                  <span className="text-sm leading-none font-medium">Cena v Kč</span>
                  {(
                    [
                      ["sDph", "s DPH"],
                      ["bezDph", "bez DPH"],
                    ] as const
                  ).map(([hodnota, popisek]) => (
                    <label key={hodnota} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="rezimCeny"
                        value={hodnota}
                        checked={rezimCeny === hodnota}
                        onChange={() => prepniRezim(hodnota)}
                        className="accent-primary size-4"
                      />
                      {popisek}
                    </label>
                  ))}
                </fieldset>
                <Label htmlFor="netPrice" className="sr-only">
                  {rezimCeny === "sDph" ? "Cena s DPH v Kč" : "Cena bez DPH v Kč"}
                </Label>
                <Input
                  id="netPrice"
                  name="netPrice"
                  value={cena}
                  onChange={(udalost) => setCena(udalost.target.value)}
                  inputMode="decimal"
                  maxLength={16}
                  autoComplete="off"
                  placeholder="9 900"
                />
                {/*
                Přepočet se ukazuje rovnou při psaní — člověk zadává cenu,
                se kterou systém počítá, a hned vidí, kolik zaplatí klient.
              */}
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {zadanaCena > 0 && sazba && rezimCeny === "sDph" ? (
                    <>
                      Bez DPH:{" "}
                      <span className="tabular text-foreground font-medium">
                        {formatMoney(bezDph(zadanaCena, sazba.rate), MENA_CENIKU)}
                      </span>
                      , daň {popisSazby(sazba.rate)}{" "}
                      {formatMoney(zadanaCena - bezDph(zadanaCena, sazba.rate), MENA_CENIKU)}.
                      Ukládá se cena bez DPH.
                    </>
                  ) : zadanaCena > 0 && sazba ? (
                    <>
                      S DPH ({popisSazby(sazba.rate)}):{" "}
                      <span className="tabular text-foreground font-medium">
                        {formatMoney(sDph(zadanaCena, sazba.rate), MENA_CENIKU)}
                      </span>
                      , z toho daň {formatMoney(castkaDph(zadanaCena, sazba.rate), MENA_CENIKU)}.
                    </>
                  ) : (
                    <>Nepovinné. Bez vyplnění se uloží 0 Kč a doplní se později.</>
                  )}
                </p>
              </div>

              {/*
              Platnost (Jakub, 24. 9. 2026): od zaplacení, další zaplacení
              navazuje. Změna se týká nových plateb — kdo už zaplatil s
              délkou, tomu zůstane.
            */}
              {/*
                Kurz má klient po zakoupení napořád (Jakub, 27. 9. 2026),
                konzultace je jednorázová (28. 9. 2026) — délka se u nich
                nenabízí a pole se neodesílá, takže se uloží prázdná.
                Členství vybírá Neomezeno, nebo počet měsíců.
              */}
              {bezPlatnosti ? (
                <div className="space-y-2">
                  <p className="text-sm leading-none font-medium">Platnost</p>
                  <p className="bg-muted/50 rounded-md border px-3 py-2 text-sm">
                    {bezPlatnosti.popis}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {bezPlatnosti.vysvetleni}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/*
                    Obyčejné přepínače, ne rozbalovací Select: ten se po
                    odeslání formuláře sám vracel na výchozí hodnotu
                    (React formulář po akci resetuje).
                  */}
                  <fieldset className="space-y-2">
                    <legend className="text-sm leading-none font-medium">Platnost</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                      {(
                        [
                          ["neomezeno", "Neomezeno"],
                          ["mesice", "Počet měsíců"],
                        ] as const
                      ).map(([hodnota, popisek]) => (
                        <label key={hodnota} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="delka"
                            value={hodnota}
                            checked={delka === hodnota}
                            onChange={() => setDelka(hodnota)}
                            className="accent-primary size-4"
                          />
                          {popisek}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {delka === "mesice" && (
                    <>
                      <Label htmlFor="validityMonths" className="sr-only">
                        Měsíců
                      </Label>
                      <Input
                        id="validityMonths"
                        name="validityMonths"
                        value={platnost}
                        onChange={(udalost) => setPlatnost(udalost.target.value)}
                        inputMode="numeric"
                        maxLength={3}
                        autoComplete="off"
                        placeholder="12"
                      />
                    </>
                  )}
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Jak dlouho produkt klientovi běží od zaplacení. Změna platí pro nová zaplacení.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="active">Stav</Label>
                <Select name="active" value={stav} onValueChange={setStav}>
                  <SelectTrigger id="active" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v-prodeji">V prodeji</SelectItem>
                    <SelectItem value="neaktivni">Neaktivní</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Neaktivní produkt zůstane v ceníku i v historii, ale nikde se nenabízí.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">Odkaz na stránku produktu</Label>
                <Input
                  id="url"
                  name="url"
                  type="url"
                  value={odkaz}
                  onChange={(udalost) => setOdkaz(udalost.target.value)}
                  maxLength={300}
                  autoComplete="off"
                  placeholder="https://"
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Nepovinné. Jen adresa začínající https://. Když je vyplněná, název produktu v
                  ceníku vede na tuhle stránku.
                </p>
              </div>
            </div>

            <DialogFooter>
              {produkt && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive sm:mr-auto"
                  onClick={() => {
                    zavri();
                    setMazani(true);
                  }}
                >
                  <Trash2 />
                  Smazat
                </Button>
              )}
              <Button type="button" variant="outline" onClick={zavri}>
                Zrušit
              </Button>
              <Button type="submit" disabled={ceka || nazev.trim() === "" || !sazbaId}>
                {ceka && <Loader2 className="animate-spin" />}
                {produkt ? "Uložit změny" : "Založit produkt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {produkt && (
        <SmazaniProduktu
          produkt={mazani ? produkt : null}
          zavrit={() => setMazani(false)}
          hotovo={() => {
            setMazani(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
