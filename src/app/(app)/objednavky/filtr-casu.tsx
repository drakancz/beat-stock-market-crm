"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filtr podle času objednávky (Jakub, 24. 9. 2026).
 *
 * Jde omezit na konkrétní **den**, **měsíc v roce**, nebo celý **rok** —
 * vždycky jen na jedno z toho. V adrese je to `?den=2026-09-24`,
 * `?mesic=2026-09`, nebo `?rok=2026`; hranice počítá server v pražském
 * čase (`prectiFiltrObjednavek()` ve `src/lib/filtry.ts`).
 *
 * Po přepnutí druhu se rovnou vybere dnešek, tento měsíc, nebo letošek,
 * ať se seznam hned zúží a člověk jen posune, co potřebuje.
 */

type Druh = "vse" | "den" | "mesic" | "rok";

const MESICE = [
  "leden",
  "únor",
  "březen",
  "duben",
  "květen",
  "červen",
  "červenec",
  "srpen",
  "září",
  "říjen",
  "listopad",
  "prosinec",
];

/** Dnešek v Praze jako `RRRR-MM-DD` — ne podle pásma počítače. */
function dnesVPraze(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Parametry, které filtr v adrese mění. Ostatní filtry nechává být. */
export const PARAMETRY_CASU = { den: null, mesic: null, rok: null } as const;

export function FiltrCasu({
  den,
  mesic,
  rok,
  roky,
  prejdi,
}: {
  den: string | null;
  mesic: string | null;
  rok: string | null;
  /** Roky, ze kterých objednávky jsou, nejnovější první. */
  roky: number[];
  prejdi: (zmeny: Record<string, string | null>) => void;
}) {
  const druh: Druh = den ? "den" : mesic ? "mesic" : rok ? "rok" : "vse";
  const dnes = dnesVPraze();

  const rokZAdresy = mesic?.slice(0, 4) ?? rok ?? dnes.slice(0, 4);
  const mesicZAdresy = mesic?.slice(5, 7) ?? dnes.slice(5, 7);

  /*
   * Rok a měsíc, které se v rozbalovacích seznamech právě ukazují. Drží se
   * i mimo adresu: kdo rychle změní rok a hned měsíc, nesmí měsíc spojit
   * se starým rokem jen proto, že se adresa ještě nestihla přepsat.
   * Když se adresa změní jinudy (Zrušit filtry, krok zpět), srovná se.
   */
  const zAdresy = `${rokZAdresy}-${mesicZAdresy}`;
  const [posledniZAdresy, setPosledniZAdresy] = useState(zAdresy);
  const [zvolene, setZvolene] = useState({ rok: rokZAdresy, mesic: mesicZAdresy });
  if (zAdresy !== posledniZAdresy) {
    setPosledniZAdresy(zAdresy);
    setZvolene({ rok: rokZAdresy, mesic: mesicZAdresy });
  }
  const zvolenyRok = zvolene.rok;
  const zvolenyMesic = zvolene.mesic;

  function zvolMesic(rokVyberu: string, mesicVyberu: string) {
    setZvolene({ rok: rokVyberu, mesic: mesicVyberu });
    prejdi({ ...PARAMETRY_CASU, mesic: `${rokVyberu}-${mesicVyberu}` });
  }

  function zvolRok(rokVyberu: string) {
    setZvolene((puvodni) => ({ ...puvodni, rok: rokVyberu }));
    prejdi({ ...PARAMETRY_CASU, rok: rokVyberu });
  }

  // Starý odkaz může nést rok, ze kterého už žádná objednávka není —
  // i tak ho výběr musí umět ukázat.
  const nabidkaRoku = roky.map(String);
  if (!nabidkaRoku.includes(zvolenyRok)) nabidkaRoku.push(zvolenyRok);

  function zmenDruh(novy: Druh) {
    if (novy === "den") prejdi({ ...PARAMETRY_CASU, den: dnes });
    else if (novy === "mesic") prejdi({ ...PARAMETRY_CASU, mesic: dnes.slice(0, 7) });
    else if (novy === "rok") prejdi({ ...PARAMETRY_CASU, rok: dnes.slice(0, 4) });
    else prejdi({ ...PARAMETRY_CASU });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={druh} onValueChange={(hodnota) => zmenDruh(hodnota as Druh)}>
        <SelectTrigger className="sm:w-44" aria-label="Filtrovat podle času objednávky">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="vse">Kdykoli</SelectItem>
          <SelectItem value="den">Konkrétní den</SelectItem>
          <SelectItem value="mesic">Měsíc</SelectItem>
          <SelectItem value="rok">Rok</SelectItem>
        </SelectContent>
      </Select>

      {druh === "den" && (
        <Input
          type="date"
          value={den ?? ""}
          max="2100-12-31"
          onChange={(udalost) => prejdi({ ...PARAMETRY_CASU, den: udalost.target.value || null })}
          aria-label="Den objednávky"
          className="sm:w-44"
        />
      )}

      {druh === "mesic" && (
        <Select value={zvolenyMesic} onValueChange={(hodnota) => zvolMesic(zvolenyRok, hodnota)}>
          <SelectTrigger className="sm:w-36" aria-label="Měsíc objednávky">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MESICE.map((nazev, index) => {
              const cislo = String(index + 1).padStart(2, "0");
              return (
                <SelectItem key={cislo} value={cislo}>
                  {nazev}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}

      {(druh === "mesic" || druh === "rok") && (
        <Select
          value={zvolenyRok}
          onValueChange={(hodnota) =>
            druh === "mesic" ? zvolMesic(hodnota, zvolenyMesic) : zvolRok(hodnota)
          }
        >
          <SelectTrigger className="sm:w-28" aria-label="Rok objednávky">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {nabidkaRoku.map((hodnota) => (
              <SelectItem key={hodnota} value={hodnota}>
                {hodnota}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
