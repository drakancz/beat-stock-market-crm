import { readFileSync } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

import { formatDatum } from "@/lib/format";

/**
 * PDF certifikátu o absolvování kurzu (Fáze 5C, 11. 10. 2026).
 *
 * Kreslí ho `pdfkit` přímo na serveru, nic neodchází mimo CRM. Písma
 * značky (Archivo, IBM Plex — licence OFL, soubory vedle v `pisma/`) jsou
 * vložená, aby čeština vyšla i bez písem v počítači klienta. Do
 * standalone sestavení je přibaluje `outputFileTracingIncludes`
 * v `next.config.ts`.
 *
 * **Barvy jsou tu napsané natvrdo** — PDF proměnné z `globals.css`
 * nezná. Odpovídají světlému vzhledu značky (modrá `--primary`, inkoust
 * `--foreground`); při změně značky je uprav i tady.
 *
 * Texty jsou bez rodu („absolvoval/a") — sedí mužům i ženám.
 */

const BARVY = {
  znacka: "#1d4a85",
  inkoust: "#151c2e",
  tlumena: "#5b6275",
  linka: "#c2bbad",
  papir: "#f6f4ef",
};

/**
 * Bez slitků („fi" jako jeden znak) — jinak by z PDF šlo zkopírovat
 * a vyhledat jen „Certifkát". fontkit je zapíná sám, vypnout jdou jen
 * objektem; pdfkit ho předá dál, jeho typy znají jen seznam.
 */
const BEZ_LIGATUR = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

const SLOZKA_PISEM = path.join(process.cwd(), "src", "lib", "vzdelavani", "pisma");

let pisma: Record<"nadpis" | "text" | "tucne" | "cisla", Buffer> | null = null;

function nactiPisma() {
  pisma ??= {
    nadpis: readFileSync(path.join(SLOZKA_PISEM, "Archivo-ExtraBold.ttf")),
    text: readFileSync(path.join(SLOZKA_PISEM, "IBMPlexSans-Regular.ttf")),
    tucne: readFileSync(path.join(SLOZKA_PISEM, "IBMPlexSans-SemiBold.ttf")),
    cisla: readFileSync(path.join(SLOZKA_PISEM, "IBMPlexMono-Regular.ttf")),
  };
  return pisma;
}

export interface UdajeCertifikatu {
  cislo: string;
  jmeno: string;
  kurz: string;
  vydano: Date;
  firma: string;
}

export function vytvorPdfCertifikatu(udaje: UdajeCertifikatu): Promise<Buffer> {
  const p = nactiPisma();
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    // Vlastní výchozí písmo — jinak by pdfkit sahal pro Helveticu do svých
    // souborů. pdfkit bere i obsah souboru, typy (@types/pdfkit 0.17) znají
    // jen cestu.
    font: p.text as unknown as string,
    info: {
      Title: `Certifikát ${udaje.cislo}`,
      Author: udaje.firma,
      Subject: `Certifikát o absolvování kurzu ${udaje.kurz}`,
    },
  });
  doc.registerFont("nadpis", p.nadpis);
  doc.registerFont("text", p.text);
  doc.registerFont("tucne", p.tucne);
  doc.registerFont("cisla", p.cisla);

  const hotovo = new Promise<Buffer>((vyres, odmitni) => {
    const casti: Buffer[] = [];
    doc.on("data", (cast: Buffer) => casti.push(cast));
    doc.on("end", () => vyres(Buffer.concat(casti)));
    doc.on("error", odmitni);
  });

  const sirka = doc.page.width;
  const vyska = doc.page.height;
  const okraj = 56;
  const obsah = sirka - 2 * okraj;

  // Podklad a dvojitý rámeček.
  doc.rect(0, 0, sirka, vyska).fill(BARVY.papir);
  doc
    .lineWidth(3)
    .strokeColor(BARVY.znacka)
    .rect(24, 24, sirka - 48, vyska - 48)
    .stroke();
  doc
    .lineWidth(0.75)
    .strokeColor(BARVY.linka)
    .rect(32, 32, sirka - 64, vyska - 64)
    .stroke();

  /** Text na střed; dlouhý text se zmenší, aby se vešel na jeden řádek. */
  const naStred = (text: string, pismo: string, velikost: number, barva: string, y: number) => {
    doc.font(pismo);
    let v = velikost;
    while (v > 12 && doc.fontSize(v).widthOfString(text) > obsah) v -= 1;
    doc
      .fillColor(barva)
      .fontSize(v)
      .text(text, okraj, y, { width: obsah, align: "center", features: BEZ_LIGATUR });
  };

  naStred(udaje.firma.toUpperCase(), "cisla", 11, BARVY.znacka, 74);
  naStred("Certifikát", "nadpis", 50, BARVY.inkoust, 112);
  naStred("o absolvování kurzu", "text", 16, BARVY.tlumena, 178);

  naStred(udaje.jmeno, "tucne", 34, BARVY.inkoust, 238);
  doc
    .lineWidth(0.75)
    .strokeColor(BARVY.linka)
    .moveTo(sirka / 2 - 160, 290)
    .lineTo(sirka / 2 + 160, 290)
    .stroke();

  naStred("Kurz", "text", 12, BARVY.tlumena, 312);
  naStred(udaje.kurz, "nadpis", 24, BARVY.znacka, 332);
  naStred("Všechny lekce kurzu prošlé, závěrečné kvízy splněné.", "text", 13, BARVY.tlumena, 378);

  // Patička: datum vlevo, číslo vpravo.
  const yPaticky = vyska - 128;
  const sloupec = obsah / 2;
  doc.font("text").fontSize(10).fillColor(BARVY.tlumena);
  doc.text("Datum vydání", okraj, yPaticky, { width: sloupec, features: BEZ_LIGATUR });
  doc.text("Číslo certifikátu", okraj + sloupec, yPaticky, {
    width: sloupec,
    align: "right",
    features: BEZ_LIGATUR,
  });
  doc.font("tucne").fontSize(14).fillColor(BARVY.inkoust);
  doc.text(formatDatum(udaje.vydano), okraj, yPaticky + 16, {
    width: sloupec,
    features: BEZ_LIGATUR,
  });
  doc.font("cisla").fontSize(14);
  doc.text(udaje.cislo, okraj + sloupec, yPaticky + 16, {
    width: sloupec,
    align: "right",
    features: BEZ_LIGATUR,
  });

  // Pravidlo 9: certifikát je o vzdělávání, ne kvalifikace ani doporučení.
  naStred(
    "Certifikát potvrzuje absolvování vzdělávacího kurzu. Není odbornou kvalifikací ani investičním doporučením.",
    "text",
    8.5,
    BARVY.tlumena,
    vyska - 64,
  );

  doc.end();
  return hotovo;
}
