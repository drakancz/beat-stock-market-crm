"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bezDiakritiky } from "@/lib/bez-diakritiky";
import { cn } from "@/lib/utils";

export interface Polozka {
  id: string;
  name: string;
}

/**
 * Výběr ze seznamu s vyhledáváním.
 *
 * Místo rozbaleného seznamu všech položek se píše a nabídka se zužuje.
 * Klientů i brokerů bude časem víc, než se vejde na obrazovku, a hledat
 * očima v dlouhém seznamu je pomalejší než napsat tři písmena.
 *
 * Hodnota se do formuláře posílá skrytým polem — `Command` je jen
 * ovládací prvek, prohlížeč o něm jako o součásti formuláře neví.
 * **Ať se vybere cokoli, server si položku ověří znovu.**
 */
export function PoleVyberu({
  polozky,
  name,
  vychozi,
  /** Popisek prázdné volby. Když chybí, výběr je povinný. */
  prazdna,
  popisekTlacitka,
  placeholderHledani,
  prazdnyVysledek,
  id,
  onZmena,
}: {
  polozky: Polozka[];
  name: string;
  vychozi?: string;
  prazdna?: { hodnota: string; popisek: string };
  popisekTlacitka: string;
  placeholderHledani: string;
  prazdnyVysledek: string;
  id?: string;
  /** Zavolá se po výběru. Formulář si tak vybranou hodnotu udrží i po odmítnutí ze serveru. */
  onZmena?: (hodnota: string) => void;
}) {
  const [hodnota, setHodnota] = useState(
    vychozi ?? (prazdna ? prazdna.hodnota : (polozky[0]?.id ?? "")),
  );
  const [otevreno, setOtevreno] = useState(false);

  const vybrana = polozky.find((polozka) => polozka.id === hodnota);
  const popisek = vybrana?.name ?? (prazdna ? prazdna.popisek : popisekTlacitka);

  function vyber(vybranaHodnota: string) {
    setHodnota(vybranaHodnota);
    setOtevreno(false);
    onZmena?.(vybranaHodnota);
  }

  return (
    <>
      <input type="hidden" name={name} value={hodnota} />

      <Popover open={otevreno} onOpenChange={setOtevreno}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={otevreno}
            // S `id` ho pojmenuje popisek formuláře (`<Label htmlFor>`).
            aria-label={id ? undefined : popisekTlacitka}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !vybrana && "text-muted-foreground")}>{popisek}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>

        {/*
          Šířka podle spouštěcího tlačítka, ať nabídka nevyskočí přes půl
          dialogu. `pointer-events-auto` je kvůli tomu, že popover leží
          uvnitř dialogu, který si jinak bere kliknutí pro sebe.
        */}
        <PopoverContent
          className="pointer-events-auto w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          {/*
            Hledá se bez ohledu na diakritiku (Jakub, 25. 9. 2026):
            „novakova" najde „Nováková". Hodnotou položky je id, aby se
            dva stejně pojmenovaní klienti nepletli; hledá se v `keywords`.
          */}
          <Command
            // Název pole s hledáním pro čtečky obrazovky (cmdk ho dá do aria-labelledby).
            label={placeholderHledani}
            filter={(_hodnota, hledat, klicova) =>
              bezDiakritiky((klicova ?? []).join(" ")).includes(bezDiakritiky(hledat.trim()))
                ? 1
                : 0
            }
          >
            <CommandInput placeholder={placeholderHledani} />
            <CommandList>
              <CommandEmpty>{prazdnyVysledek}</CommandEmpty>
              <CommandGroup>
                {prazdna && (
                  <CommandItem
                    value={prazdna.hodnota}
                    keywords={[prazdna.popisek]}
                    onSelect={() => vyber(prazdna.hodnota)}
                  >
                    <Check
                      className={cn(hodnota === prazdna.hodnota ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {prazdna.popisek}
                  </CommandItem>
                )}
                {polozky.map((polozka) => (
                  <CommandItem
                    key={polozka.id}
                    // Hledá se podle názvu (`keywords`), ne podle id — člověk píše
                    // „Nováková", ne „cmf3x…".
                    value={polozka.id}
                    keywords={[polozka.name]}
                    onSelect={() => vyber(polozka.id)}
                  >
                    <Check
                      className={cn(hodnota === polozka.id ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {polozka.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
