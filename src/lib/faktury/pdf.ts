import { readFileSync } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

import { formatDatum, formatMoney } from "@/lib/format";
import { jeUkazka } from "@/lib/ukazka";

import { rozpisDph, type Dodavatel, type Odberatel, type PolozkaFaktury } from "./faktury";

/**
 * PDF faktury a dobropisu (19. 10. 2026). Kreslí ho `pdfkit` na serveru
 * se stejnými písmy značky jako certifikát (`vzdelavani/pisma/`, přibaluje
 * je `outputFileTracingIncludes` v `next.config.ts`). Barvy natvrdo —
 * PDF proměnné z `globals.css` nezná.
 *
 * **Šablonu má zkontrolovat účetní.** Náležitosti daňového dokladu podle
 * zákona o DPH: číslo, dodavatel a odběratel (u zjednodušeného jen
 * dodavatel), DIČ, datum vystavení a plnění, rozsah plnění, základ a DPH
 * po sazbách.
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

export interface UdajeDokladu {
  cislo: string;
  dobropis: boolean;
  opravuje: string | null;
  zjednoduseny: boolean;
  objednavka: string;
  vystaveno: Date;
  plneni: Date;
  mena: string;
  dodavatel: Dodavatel;
  odberatel: Odberatel;
  polozky: PolozkaFaktury[];
  zaklad: number;
  dph: number;
  celkem: number;
}

function nadpisDokladu(d: UdajeDokladu): string {
  if (d.dobropis) return "Opravný daňový doklad (dobropis)";
  if (!d.dodavatel.platceDph) return "Faktura";
  return d.zjednoduseny ? "Zjednodušený daňový doklad" : "Faktura — daňový doklad";
}

export function vytvorPdfDokladu(d: UdajeDokladu): Promise<Buffer> {
  const p = nactiPisma();
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    font: p.text as unknown as string,
    info: { Title: `${nadpisDokladu(d)} ${d.cislo}`, Author: d.dodavatel.nazev },
  });
  doc.registerFont("nadpis", p.nadpis);
  doc.registerFont("text", p.text);
  doc.registerFont("tucne", p.tucne);

  const casti: Buffer[] = [];
  doc.on("data", (kus: Buffer) => casti.push(kus));
  const hotovo = new Promise<Buffer>((vyres) => doc.on("end", () => vyres(Buffer.concat(casti))));

  const text = (obsah: string, x: number, y: number, volby: PDFKit.Mixins.TextOptions = {}) =>
    doc.text(obsah, x, y, { features: BEZ_LIGATUR, ...volby });
  const penize = (castka: number) => formatMoney(castka, d.mena);
  const sirka = doc.page.width - 100;

  // Hlavička
  doc.font("nadpis").fontSize(18).fillColor(BARVY.znacka);
  text(nadpisDokladu(d), 50, 50);
  doc.font("tucne").fontSize(12).fillColor(BARVY.inkoust);
  text(`Číslo ${d.cislo}`, 50, 76);
  // Ukázka (src/lib/ukazka.ts): firma je vymyšlená, doklad nic neplatí.
  if (jeUkazka()) {
    doc.font("tucne").fontSize(9).fillColor(BARVY.znacka);
    text("Ukázkový doklad — vymyšlená firma, nemá žádnou platnost.", 50, 96);
  }
  doc.font("text").fontSize(9).fillColor(BARVY.tlumena);
  text(
    [
      `Datum vystavení: ${formatDatum(d.vystaveno)}`,
      `Datum uskutečnění plnění: ${formatDatum(d.plneni)}`,
      `Objednávka: ${d.objednavka}`,
      d.opravuje ? `Opravuje doklad: ${d.opravuje}` : "Uhrazeno platební bránou nebo převodem",
    ].join("\n"),
    330,
    50,
    { width: sirka - 280, align: "right" },
  );

  // Dodavatel a odběratel
  const blok = (nadpis: string, radky: (string | null | false)[], x: number) => {
    doc.font("tucne").fontSize(9).fillColor(BARVY.tlumena);
    text(nadpis.toUpperCase(), x, 120);
    doc.font("text").fontSize(10).fillColor(BARVY.inkoust);
    text(radky.filter(Boolean).join("\n"), x, 134, { width: 230 });
  };
  const dod = d.dodavatel;
  blok(
    "Dodavatel",
    [
      dod.nazev,
      dod.adresa,
      dod.ico && `IČO: ${dod.ico}`,
      dod.dic && `DIČ: ${dod.dic}`,
      dod.ucet && `Účet: ${dod.ucet}`,
      !dod.platceDph && "Není plátce DPH",
    ],
    50,
  );
  const odb = d.odberatel;
  if (!d.zjednoduseny || odb.ulice) {
    blok(
      "Odběratel",
      [
        odb.nazev,
        odb.ulice,
        [odb.psc, odb.mesto].filter(Boolean).join(" ") || null,
        odb.zeme && odb.zeme !== "CZ" ? odb.zeme : null,
        odb.ico && `IČO: ${odb.ico}`,
        odb.dic && `DIČ: ${odb.dic}`,
      ],
      320,
    );
  }

  // Položky
  // Částky mají místo i se znaménkem dobropisu („-12 079,00 Kč“).
  const sloupce = [
    { nazev: "Položka", x: 50, w: 150, zarovnani: "left" as const },
    { nazev: "Ks", x: 200, w: 25, zarovnani: "right" as const },
    { nazev: "Cena/ks bez DPH", x: 225, w: 75, zarovnani: "right" as const },
    { nazev: "DPH %", x: 300, w: 35, zarovnani: "right" as const },
    { nazev: "Základ", x: 335, w: 70, zarovnani: "right" as const },
    { nazev: "DPH", x: 405, w: 65, zarovnani: "right" as const },
    { nazev: "Celkem", x: 470, w: 75, zarovnani: "right" as const },
  ];
  let y = 240;
  doc.font("tucne").fontSize(8).fillColor(BARVY.tlumena);
  for (const s of sloupce) text(s.nazev, s.x, y, { width: s.w, align: s.zarovnani });
  y += 14;
  doc
    .moveTo(50, y)
    .lineTo(50 + sirka, y)
    .strokeColor(BARVY.linka)
    .lineWidth(0.5)
    .stroke();
  y += 6;

  doc.font("text").fontSize(9).fillColor(BARVY.inkoust);
  for (const pol of d.polozky) {
    const hodnoty = [
      pol.nazev,
      String(pol.kusu),
      penize(pol.cenaBezDph),
      dod.platceDph ? `${pol.sazba} %` : "—",
      penize(pol.zaklad),
      penize(pol.dph),
      penize(pol.celkem),
    ];
    // Výška řádku podle nejvyšší buňky — kdyby se zalomila i částka,
    // nepřeteče přes další řádek ani přes čáru.
    const vyska = Math.max(
      ...hodnoty.map((h, i) => doc.heightOfString(h, { width: sloupce[i]!.w })),
    );
    hodnoty.forEach((h, i) =>
      text(h, sloupce[i]!.x, y, { width: sloupce[i]!.w, align: sloupce[i]!.zarovnani }),
    );
    y += Math.max(vyska, 12) + 6;
  }
  doc
    .moveTo(50, y)
    .lineTo(50 + sirka, y)
    .strokeColor(BARVY.linka)
    .stroke();
  y += 12;

  // Rozpis DPH a součty
  if (dod.platceDph) {
    doc.font("tucne").fontSize(8).fillColor(BARVY.tlumena);
    text("Rekapitulace DPH", 300, y);
    y += 12;
    doc.font("text").fontSize(9).fillColor(BARVY.inkoust);
    for (const r of rozpisDph(d.polozky)) {
      text(`${r.sazba} %: základ ${penize(r.zaklad)}, DPH ${penize(r.dph)}`, 300, y, {
        width: 245,
        align: "right",
      });
      y += 13;
    }
    y += 6;
  }
  doc.font("nadpis").fontSize(13).fillColor(BARVY.znacka);
  text(`Celkem ${penize(d.celkem)}`, 300, y, { width: 245, align: "right" });
  y += 20;
  doc.font("text").fontSize(9).fillColor(BARVY.tlumena);
  text(d.dobropis ? "Částka bude vrácena." : "Uhrazeno — nic nedoplácíte.", 300, y, {
    width: 245,
    align: "right",
  });

  doc.end();
  return hotovo;
}
