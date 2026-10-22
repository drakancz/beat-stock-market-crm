import { z } from "zod";

import { denParam, posunDne, zacatekDne } from "@/lib/obdobi";
import { parametr, precti, textParam, vyberParam, type Parametry } from "@/lib/parametry";
import type { FiltrKlientu, FiltrObjednavek } from "@/lib/queries";
import { ORDER_STATUSES } from "@/lib/types";

/**
 * Čtení filtrů z adresy.
 *
 * Filtry žijí v adrese (`/klienti?hledat=novak&stav=MA_ZAJEM`), ne ve stavu
 * komponenty. Odkaz na vyfiltrovaný seznam se pak dá poslat kolegovi a
 * po obnovení stránky zůstane zobrazené totéž.
 *
 * **Všechno, co přijde z adresy, je vstup od uživatele** (security_warnings.md,
 * pravidlo 11). Proto se čte schématem zod (security.md, pravidlo 4):
 * hodnoty se ořežou na délku, stav se přijme jen tehdy, když je z uzavřeného
 * seznamu, a zbytek se zahodí — do dotazu se nikdy nedostane nic, co jsme
 * neschválili.
 */

export type { Parametry };

/** Nejdelší rozumný hledaný výraz. Delší vstup je nesmysl nebo pokus o zátěž. */
const MAX_DELKA_HLEDANI = 100;

/** Id v adrese — delší než 64 znaků žádné není. */
const MAX_DELKA_ID = 64;

/**
 * Filtr podle stavu klienta zanikl 23. 9. 2026 (Jakub) spolu se sloupcem
 * Stav v seznamu. Starý odkaz s `?stav=` se tiše ignoruje.
 *
 * Štítek, přístup do programu a platnost přibyly 11. 10. 2026 (Fáze 5B)
 * kvůli uloženým filtrům a hromadným akcím.
 */
export const PRISTUPY = ["POVOLEN", "NEPOVOLEN"] as const;
export const PLATNOSTI = ["BEZI", "SKONCILA", "ZADNA"] as const;
/** „Platí, ale nechodí“ (Fáze 5B, 15. 10. 2026) — `src/lib/nechodi.ts`. */
export const AKTIVITY = ["NECHODI"] as const;

const filtrKlientu = z.object({
  hledat: textParam(MAX_DELKA_HLEDANI),
  stitek: textParam(MAX_DELKA_ID),
  pristup: vyberParam(PRISTUPY),
  platnost: vyberParam(PLATNOSTI),
  aktivita: vyberParam(AKTIVITY),
  // Vlastní pole `<id pole>:<hodnota>` (Fáze 5B, 18. 10. 2026).
  pole: textParam(MAX_DELKA_ID + 1 + 60),
});

export function prectiFiltr(parametry: Parametry): FiltrKlientu {
  const vstup = precti(filtrKlientu, parametry);

  return {
    hledat: vstup.hledat,
    stitek: vstup.stitek?.trim() || undefined,
    pristup: vstup.pristup,
    platnost: vstup.platnost,
    aktivita: vstup.aktivita,
    pole: vstup.pole?.trim() || undefined,
  };
}

/** Je nastavený aspoň jeden filtr? Podle toho se liší hláška u prázdného seznamu. */
export function filtrujeSe(filtr: FiltrKlientu): boolean {
  return Boolean(
    filtr.hledat || filtr.stitek || filtr.pristup || filtr.platnost || filtr.aktivita || filtr.pole,
  );
}

/**
 * Část adresy za otazníkem pro uložený filtr (Fáze 5B) — jen parametry
 * filtru klientů, přečtené stejně přísně jako odkaz. Cokoli jiného
 * se zahodí. Prázdný řetězec = žádný filtr.
 */
export function ulozitelnyDotaz(parametry: Parametry): string {
  const filtr = prectiFiltr(parametry);
  const dotaz = new URLSearchParams();
  if (filtr.hledat?.trim()) dotaz.set("hledat", filtr.hledat.trim());
  if (filtr.stitek) dotaz.set("stitek", filtr.stitek);
  if (filtr.pristup) dotaz.set("pristup", filtr.pristup);
  if (filtr.platnost) dotaz.set("platnost", filtr.platnost);
  if (filtr.aktivita) dotaz.set("aktivita", filtr.aktivita);
  if (filtr.pole) dotaz.set("pole", filtr.pole);
  return dotaz.toString();
}

/** Nejmenší a největší rok, který dává ve filtru smysl. */
const NEJMENSI_ROK = 2000;
const NEJVETSI_ROK = 2100;

function rokDavaSmysl(rok: number): boolean {
  return Number.isInteger(rok) && rok >= NEJMENSI_ROK && rok <= NEJVETSI_ROK;
}

/**
 * Měsíc v adrese (`?mesic=2026-09`). Tvar se ověřuje uvnitř `refine()`,
 * ne přes `.regex()` — zod by po nesplněné kontrole pokračoval dál
 * (security.md, past v zod 4).
 */
const mesicParam = parametr(
  z
    .string()
    .refine((hodnota) => {
      if (!/^\d{4}-\d{2}$/.test(hodnota)) return false;
      const [rok, mesic] = hodnota.split("-").map(Number);
      return rokDavaSmysl(rok) && mesic >= 1 && mesic <= 12;
    })
    .transform((hodnota) => {
      const [rok, mesic] = hodnota.split("-").map(Number);
      return { rok, mesic };
    }),
  undefined,
);

/** Rok v adrese (`?rok=2026`). */
const rokParam = parametr(
  z
    .string()
    .refine((hodnota) => /^\d{4}$/.test(hodnota) && rokDavaSmysl(Number(hodnota)))
    .transform(Number),
  undefined,
);

const filtrObjednavek = z.object({
  hledat: textParam(MAX_DELKA_HLEDANI),
  stav: vyberParam(ORDER_STATUSES.map((polozka) => polozka.id)),
  klient: textParam(MAX_DELKA_ID),
  den: denParam,
  mesic: mesicParam,
  rok: rokParam,
});

/**
 * Filtry nad objednávkami.
 *
 * Stav jen z uzavřeného seznamu, hledaný výraz a id zkrácené na délku.
 * Filtr podle přístupu do programu zanikl 23. 9. 2026 — přístup je od
 * té doby u klienta; starý odkaz s `?pristup=` se tiše ignoruje.
 *
 * **Čas objednávky** (Jakub, 24. 9. 2026) jde omezit na den, měsíc, nebo
 * rok — vždycky jen jedno. Kdyby adresa nesla víc, vyhraje nejužší (den
 * před měsícem před rokem). Hranice jsou v pražském čase a „do" je
 * začátek následujícího období, protože objednávka má i čas.
 */
export function prectiFiltrObjednavek(parametry: Parametry): FiltrObjednavek {
  const vstup = precti(filtrObjednavek, parametry);

  let od: Date | undefined;
  let doCasu: Date | undefined;

  if (vstup.den) {
    od = vstup.den;
    doCasu = posunDne(vstup.den, 1);
  } else if (vstup.mesic) {
    const { rok, mesic } = vstup.mesic;
    od = zacatekDne(rok, mesic, 1);
    doCasu = mesic === 12 ? zacatekDne(rok + 1, 1, 1) : zacatekDne(rok, mesic + 1, 1);
  } else if (vstup.rok) {
    od = zacatekDne(vstup.rok, 1, 1);
    doCasu = zacatekDne(vstup.rok + 1, 1, 1);
  }

  return {
    hledat: vstup.hledat,
    stav: vstup.stav,
    klientId: vstup.klient,
    od,
    do: doCasu,
  };
}

/** Je nastavený aspoň jeden filtr? Podle toho se liší hláška u prázdného seznamu. */
export function filtrujiSeObjednavky(filtr: FiltrObjednavek): boolean {
  return Boolean(filtr.hledat || filtr.stav || filtr.klientId || filtr.od);
}
