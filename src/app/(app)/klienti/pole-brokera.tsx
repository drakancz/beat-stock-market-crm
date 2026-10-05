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
import { cn } from "@/lib/utils";

import { BEZ_BROKERA, type VolbaBrokera } from "./vyber-brokera";

/**
 * Výběr brokera s vyhledáváním.
 *
 * Místo rozbaleného seznamu všech brokerů se píše a nabídka se zužuje.
 * Brokerů bude časem víc, než se vejde na obrazovku, a hledat očima
 * v dlouhém seznamu je pomalejší než napsat tři písmena.
 *
 * Hodnota se do formuláře posílá skrytým polem — `Command` je jen
 * ovládací prvek, prohlížeč o něm jako o součásti formuláře neví.
 * Ať se vybere cokoli, **server si brokera stejně ověří znovu**.
 */
export function PoleBrokera({
  brokeri,
  /** Pod jakým názvem hodnota odejde ve formuláři. */
  name = "brokerId",
  /** Smí se nechat prázdné? U zakládání klienta ano. */
  nepovinny = false,
  vychozi,
}: {
  brokeri: VolbaBrokera[];
  name?: string;
  nepovinny?: boolean;
  vychozi?: string;
}) {
  const [hodnota, setHodnota] = useState(
    vychozi ?? (nepovinny ? BEZ_BROKERA : (brokeri[0]?.id ?? "")),
  );
  const [otevreno, setOtevreno] = useState(false);

  const vybrany = brokeri.find((broker) => broker.id === hodnota);
  const popisek = vybrany?.name ?? (nepovinny ? "Zatím žádný" : "Vyber brokera");

  function vyber(id: string) {
    setHodnota(id);
    setOtevreno(false);
  }

  return (
    <>
      <input type="hidden" name={name} value={hodnota} />

      <Popover open={otevreno} onOpenChange={setOtevreno}>
        <PopoverTrigger asChild>
          {/* `id` stejné jako `name`, ať na tlačítko ukazuje `<Label htmlFor>`. */}
          <Button
            id={name}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={otevreno}
            aria-label="Vybrat brokera"
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !vybrany && "text-muted-foreground")}>{popisek}</span>
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
          <Command>
            <CommandInput placeholder="Hledat brokera…" />
            <CommandList>
              <CommandEmpty>Žádný broker tomu neodpovídá.</CommandEmpty>
              <CommandGroup>
                {nepovinny && (
                  <CommandItem value="Zatím žádný" onSelect={() => vyber(BEZ_BROKERA)}>
                    <Check
                      className={cn(hodnota === BEZ_BROKERA ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    Zatím žádný
                  </CommandItem>
                )}
                {brokeri.map((broker) => (
                  <CommandItem
                    key={broker.id}
                    // Hledá se podle názvu, ne podle id — člověk píše
                    // „interactive", ne „ibkr".
                    value={broker.name}
                    onSelect={() => vyber(broker.id)}
                  >
                    <Check
                      className={cn(hodnota === broker.id ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {broker.name}
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
