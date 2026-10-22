import { readFileSync } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

import { formatDatumCas } from "@/lib/format";

import type { MojeUdaje } from "./moje-udaje";

/**
 * PDF k přečtení „Moje údaje“ (21. 10. 2026). Stejný obsah jako JSON
 * (`MojeUdaje`), jen pro člověka. Písma značky jako certifikát a faktura
 * (`vzdelavani/pisma/`, přibaluje je `outputFileTracingIncludes`
 * v `next.config.ts`). Barvy natvrdo — PDF proměnné z `globals.css` nezná.
 */

const BARVY = { znacka: "#1d4a85", inkoust: "#151c2e", tlumena: "#5b6275", linka: "#c2bbad" };

/** Bez slitků — z PDF má jít zkopírovat text tak, jak je (viz certifikát). */
const BEZ_LIGATUR = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

const SLOZKA_PISEM = path.join(process.cwd(), "src", "lib", "vzdelavani", "pisma");
let pisma: Record<"nadpis" | "text" | "tucne", Buffer> | null = null;

function nactiPisma() {
  pisma ??= {
    nadpis: readFileSync(path.join(SLOZKA_PISEM, "Archivo-ExtraBold.ttf")),
    text: readFileSync(path.join(SLOZKA_PISEM, "IBMPlexSans-Regular.ttf")),
    tucne: readFileSync(path.join(SLOZKA_PISEM, "IBMPlexSans-SemiBold.ttf")),
  };
  return pisma;
}

function zobraz(hodnota: string | number | boolean | null): string {
  if (hodnota === null || hodnota === "") return "—";
  if (typeof hodnota === "boolean") return hodnota ? "ano" : "ne";
  return String(hodnota);
}

export function vytvorPdfMojichUdaju(udaje: MojeUdaje): Promise<Buffer> {
  const p = nactiPisma();
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    font: p.text as unknown as string,
    info: { Title: "Moje údaje", Author: udaje.spravce.nazev },
  });
  doc.registerFont("nadpis", p.nadpis);
  doc.registerFont("text", p.text);
  doc.registerFont("tucne", p.tucne);

  const casti: Buffer[] = [];
  doc.on("data", (kus: Buffer) => casti.push(kus));
  const hotovo = new Promise<Buffer>((vyres) => doc.on("end", () => vyres(Buffer.concat(casti))));

  const sirka = doc.page.width - 100;
  const text = (obsah: string, volby: PDFKit.Mixins.TextOptions = {}) =>
    doc.text(obsah, { features: BEZ_LIGATUR, width: sirka, ...volby });

  doc.font("nadpis").fontSize(20).fillColor(BARVY.znacka);
  text("Moje údaje");
  doc.font("text").fontSize(9).fillColor(BARVY.tlumena);
  text(
    [
      `Vytvořeno ${formatDatumCas(udaje.vytvoreno)}`,
      `Správce údajů: ${udaje.spravce.nazev}${udaje.spravce.kontakt ? `, ${udaje.spravce.kontakt}` : ""}`,
      "Stejné údaje ve strojově čitelné podobě najdete v souboru JSON v Mém profilu.",
    ].join("\n"),
  );

  for (const oddil of udaje.oddily) {
    doc.moveDown(1.2);
    // Nadpis oddílu nemá zůstat sám na konci stránky.
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font("tucne").fontSize(12).fillColor(BARVY.znacka);
    text(oddil.nazev);
    doc.moveDown(0.3);

    if (oddil.zaznamy.length === 0) {
      doc.font("text").fontSize(9.5).fillColor(BARVY.tlumena);
      text("Žádné záznamy.");
      continue;
    }

    oddil.zaznamy.forEach((zaznam, i) => {
      if (i > 0) {
        doc.moveDown(0.3);
        doc
          .moveTo(50, doc.y)
          .lineTo(50 + sirka, doc.y)
          .lineWidth(0.5)
          .strokeColor(BARVY.linka)
          .stroke();
        doc.moveDown(0.3);
      }
      for (const [klic, hodnota] of Object.entries(zaznam)) {
        doc.font("tucne").fontSize(9.5).fillColor(BARVY.tlumena);
        text(`${klic}: `, { continued: true });
        doc.font("text").fillColor(BARVY.inkoust);
        text(zobraz(hodnota));
      }
    });
  }

  doc.end();
  return hotovo;
}
