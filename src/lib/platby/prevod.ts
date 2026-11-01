import { renderSVG } from "uqr";

import { db } from "@/lib/db";
import { cenaPolozkySDph } from "@/lib/dph";

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

/** Údaje k platbě převodem, jak je dostane Landing Page po objednání. */
export interface UdajeKPrevodu {
  /** Celkem s DPH (po slevě) — stejný součet jako v klientské části. */
  castka: number;
  mena: string;
  cisloUctu: string;
  iban: string;
  variabilniSymbol: string;
  prijemce: string | null;
  /** Text QR platby (SPAYD) — QR kód z něj nakreslí web sám. */
  qrPlatba: string;
}

/**
 * Údaje k převodu pro objednávku z Landing Page (krok 1B, 26. 10. 2026).
 * Web po objednání ukáže částku, účet, variabilní symbol a QR kód —
 * v ukázce je brána GoPay vypnutá a převod je jediná cesta.
 *
 * Částka se sčítá z položek objednávky (cena ze chvíle objednávky, po
 * slevě), nikdy z ceníku ani z požadavku. `null`, když v Nastavení → Firma
 * chybí platné číslo účtu — objednávka se tím neruší.
 */
export async function udajeKPrevodu(orderId: string): Promise<UdajeKPrevodu | null> {
  const [objednavka, firma] = await Promise.all([
    db.order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        currency: true,
        items: {
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: { select: { netPrice: true, vatRate: { select: { rate: true } } } },
          },
        },
      },
    }),
    db.companySettings.findUnique({
      where: { id: "firma" },
      select: { bankAccount: true, companyName: true },
    }),
  ]);
  if (!objednavka || !firma?.bankAccount) return null;

  const iban = ibanZCislaUctu(firma.bankAccount);
  if (!iban) return null;

  // Na haléře — součet desetinných čísel by jinak nechal zbytek (0,30000000004).
  const castka =
    Math.round(
      objednavka.items.reduce(
        (soucet, polozka) => soucet + polozka.quantity * cenaPolozkySDph(polozka),
        0,
      ) * 100,
    ) / 100;
  const vs = variabilniSymbol(objednavka.number);

  return {
    castka,
    mena: objednavka.currency,
    cisloUctu: firma.bankAccount,
    iban,
    variabilniSymbol: vs,
    prijemce: firma.companyName,
    qrPlatba: textQrPlatby({
      iban,
      castka,
      mena: objednavka.currency,
      vs,
      zprava: `Objednavka ${objednavka.number}`,
    }),
  };
}

/** Dá se platit převodem? Jen když je v Nastavení → Firma platné číslo účtu. */
export async function prevodemZaplatitLze(): Promise<boolean> {
  const firma = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { bankAccount: true },
  });
  return !!firma?.bankAccount && ibanZCislaUctu(firma.bankAccount) !== null;
}
