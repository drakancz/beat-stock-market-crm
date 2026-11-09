import { readFileSync } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

import { db } from "@/lib/db";
import { jeS3Nastavene, ulozDoS3 } from "@/lib/uloziste";

/**
 * Vymyšlené materiály ke stažení pro ukázku (Jakub, 3. 11. 2026).
 *
 * Noční obnova ukázky (`naplnUkazku()`) je přidá ke třem lekcím kurzu
 * Základy investování. PDF se kreslí tady na serveru (`pdfkit`, písma
 * značky jako u certifikátu) a uloží do S3 pod **pevnými klíči**
 * `ukazka/materialy/…` — každou noc se přepíšou, takže v úložišti
 * nezůstávají staré kopie. Nahrávání je v ukázce vypnuté, tohle je
 * jediná cesta, jak se tam materiál dostane.
 *
 * Bez nastaveného S3 se materiály nevytvoří (ukázka funguje dál, jen
 * u lekcí žádné nejsou).
 *
 * **Texty jsou vzdělávací, bez tipů na nákup** (security_warnings.md,
 * pravidlo 9). Změny dávej Jakubovi ke schválení (docs/funkce/ukazka.md).
 */

interface UkazkovyMaterial {
  /** Pořadí lekce v kurzu Základy investování, od 0. */
  lekce: number;
  klic: string;
  nazev: string;
  nadpis: string;
  odstavce: string[];
}

export const UKAZKOVE_MATERIALY: UkazkovyMaterial[] = [
  {
    lekce: 0,
    klic: "ukazka/materialy/slovnicek-pojmu.pdf",
    nazev: "Slovníček pojmů – akcie a burza.pdf",
    nadpis: "Slovníček pojmů: akcie a burza",
    odstavce: [
      "Akcie – podíl na firmě. Majitel má nárok na část vyplaceného zisku a může hlasovat na valné hromadě.",
      "Dividenda – část zisku, kterou firma vyplácí akcionářům. Firma ji vyplácet nemusí.",
      "Burza – místo, kde se potkávají kupující a prodávající. Cena je poslední cena, na které se dohodli.",
      "Likvidita – jak snadno jde něco koupit nebo prodat, aniž by se tím pohnula cena.",
      "Index – koš vybraných akcií, podle kterého se měří, jak se daří celému trhu nebo jeho části.",
      "Tento materiál je vzdělávací. Nejde o investiční doporučení.",
    ],
  },
  {
    lekce: 3,
    klic: "ukazka/materialy/poplatky-kontrolni-seznam.pdf",
    nazev: "Poplatky – kontrolní seznam.pdf",
    nadpis: "Poplatky: kontrolní seznam",
    odstavce: [
      "Projděte si u každého účtu nebo fondu tyto otázky a odpovědi si zapište.",
      "1. Kolik stojí jeden nákup a jeden prodej?",
      "2. Platím poplatek za vedení účtu nebo za nečinnost?",
      "3. Jaké jsou roční náklady fondu (TER)?",
      "4. Kolik stojí převod měny a jaký kurz se používá?",
      "5. Platím něco za výběr peněz nebo za převod jinam?",
      "Sečtěte, kolik vás poplatky stojí za rok, a porovnejte to s částkou, kterou investujete.",
      "Tento materiál je vzdělávací. Nejde o investiční doporučení.",
    ],
  },
  {
    lekce: 4,
    klic: "ukazka/materialy/investicni-denik-sablona.pdf",
    nazev: "Investiční deník – šablona.pdf",
    nadpis: "Investiční deník: šablona",
    odstavce: [
      "Ke každému rozhodnutí si zapište jeden řádek. Za půl roku uvidíte, podle čeho jste se rozhodovali.",
      "Datum: ……………………",
      "Rozhodnutí a jeho důvod: ……………………………………………………",
      "Co čekám, že se stane: ……………………………………………………",
      "Kdy to vyhodnotím: ……………………",
      "Nálada při rozhodnutí – klid, nejistota, strach, nadšení: ……………………",
      "Tento materiál je vzdělávací. Nejde o investiční doporučení.",
    ],
  },
];

const SLOZKA_PISEM = path.join(process.cwd(), "src", "lib", "vzdelavani", "pisma");

/** Jednoduché A4 PDF s nadpisem a odstavci. */
export function vytvorPdfMaterialu(nadpis: string, odstavce: string[]): Promise<Buffer> {
  const text = readFileSync(path.join(SLOZKA_PISEM, "IBMPlexSans-Regular.ttf"));
  const tucne = readFileSync(path.join(SLOZKA_PISEM, "Archivo-ExtraBold.ttf"));

  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    // pdfkit bere i obsah souboru, typy znají jen cestu (viz certifikat-pdf.ts).
    font: text as unknown as string,
    info: { Title: nadpis, Author: "Beat Stock Market (ukázka)" },
  });
  doc.registerFont("nadpis", tucne);
  doc.registerFont("text", text);

  const kusy: Buffer[] = [];
  doc.on("data", (kus: Buffer) => kusy.push(kus));
  const hotovo = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(kusy)));
    doc.on("error", reject);
  });

  // Barvy natvrdo — PDF nezná proměnné z globals.css (jako certifikát).
  doc.font("nadpis").fontSize(22).fillColor("#1d4a85").text(nadpis);
  doc.moveDown(0.3);
  doc.font("text").fontSize(9).fillColor("#5b6275").text("Ukázkový materiál · Beat Stock Market");
  doc.moveDown(1.2);
  doc.fontSize(12).fillColor("#151c2e");
  for (const odstavec of odstavce) {
    doc.text(odstavec, { lineGap: 3 });
    doc.moveDown(0.7);
  }
  doc.end();
  return hotovo;
}

/**
 * Uloží materiály do S3 a zapíše je k lekcím. Vrací, kolik jich vzniklo.
 * Chyba úložiště obnovu ukázky neshodí — materiály prostě chybí.
 */
export async function pridejUkazkoveMaterialy(
  lekceZaklady: string[],
  nahralId: string,
): Promise<number> {
  if (!jeS3Nastavene()) return 0;

  let pridano = 0;
  for (const material of UKAZKOVE_MATERIALY) {
    const lessonId = lekceZaklady[material.lekce];
    if (!lessonId) continue;
    try {
      const pdf = await vytvorPdfMaterialu(material.nadpis, material.odstavce);
      await ulozDoS3(material.klic, new Uint8Array(pdf), "application/pdf");
      await db.attachment.create({
        data: {
          key: material.klic,
          storage: "S3",
          name: material.nazev,
          mimeType: "application/pdf",
          size: pdf.byteLength,
          ownerType: "LEKCE",
          ownerId: lessonId,
          uploadedById: nahralId,
        },
      });
      pridano++;
    } catch (chyba) {
      console.error(
        "Ukázkový materiál se nepodařilo uložit:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }
  return pridano;
}
