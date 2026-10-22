import { renderSVG } from "uqr";

import { db } from "@/lib/db";

/**
 * Platba převodem v klientské části (Jakub, 20. 10. 2026): číslo účtu
 * z Nastavení → Firma, variabilní symbol z čísla objednávky a QR platba
 * (formát SPAYD, který čtou české bankovní aplikace).
 *
 * Nic se tu neposílá ven — QR kód kreslí server jako obrázek SVG
 * (`uqr`), banka se o platbě dozví až od klienta. Zaplaceno dál přepíná
 * administrátor, jako u každé platby převodem.
 */

/**
 * IBAN z českého čísla účtu („123-4567890/0100“, „4567890/0100“), nebo
 * `null`, když číslo tvar nemá. Hotový IBAN (CZ + 22 číslic) se jen
 * sjednotí. Kontrolní číslice podle ISO 13616 (mod 97).
 */
export function ibanZCislaUctu(ucet: string): string | null {
  const text = ucet.replace(/\s/g, "").toUpperCase();
  if (/^CZ\d{22}$/.test(text)) return text;

  const shoda = text.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!shoda) return null;
  const [, predcisli = "", cislo = "", banka = ""] = shoda;

  const bban = banka + predcisli.padStart(6, "0") + cislo.padStart(10, "0");
  // „CZ00“ přesunuté na konec, písmena jako čísla: C = 12, Z = 35.
  const zbytek = BigInt(`${bban}123500`) % BigInt(97);
  const kontrola = String(BigInt(98) - zbytek).padStart(2, "0");
  return `CZ${kontrola}${bban}`;
}

/** Variabilní symbol z čísla objednávky: „2026-0011“ → „20260011“. */
export function variabilniSymbol(cisloObjednavky: string): string {
  return cisloObjednavky.replace(/\D/g, "").slice(0, 10);
}

/**
 * Text QR platby (SPAYD 1.0). Zpráva jen ASCII bez hvězdičky — některé
 * bankovní aplikace diakritiku v QR nečtou.
 */
export function textQrPlatby(vstup: {
  iban: string;
  castka: number;
  mena: string;
  vs: string;
  zprava: string;
}): string {
  const zprava = vstup.zprava
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,:/-]/g, "")
    .slice(0, 60);
  return [
    "SPD*1.0",
    `ACC:${vstup.iban}`,
    `AM:${vstup.castka.toFixed(2)}`,
    `CC:${vstup.mena}`,
    `X-VS:${vstup.vs}`,
    `MSG:${zprava}`,
  ].join("*");
}

/** QR kód jako SVG (text). Barvy bere z `currentColor`, ať sedí v obou vzhledech. */
export function qrSvg(text: string): string {
  return renderSVG(text, {
    ecc: "M",
    border: 2,
    whiteColor: "transparent",
    blackColor: "currentColor",
  });
}

/** Dá se platit převodem? Jen když je v Nastavení → Firma platné číslo účtu. */
export async function prevodemZaplatitLze(): Promise<boolean> {
  const firma = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { bankAccount: true },
  });
  return !!firma?.bankAccount && ibanZCislaUctu(firma.bankAccount) !== null;
}
