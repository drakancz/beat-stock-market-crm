import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Prisma } from "../src/generated/prisma/client";
import { csvFaktur, isdocXml, pohodaXml } from "../src/lib/faktury/export";
import type {
  Dodavatel,
  Odberatel,
  PolozkaFaktury,
  VYBER_DOKLADU,
} from "../src/lib/faktury/faktury";
import { vytvorPdfDokladu } from "../src/lib/faktury/pdf";

/**
 * Ukázkové doklady pro účetní (Jakub, 20. 10. 2026): faktura, zjednodušený
 * doklad, dvě sazby DPH, dobropis a faktura neplátce — PDF, Pohoda XML,
 * ISDOC a CSV. Kreslí se stejným kódem jako v CRM, ale z vymyšlených údajů
 * a bez databáze. Firma ještě nemá IČO, proto jsou všechna čísla zjevně
 * falešná (12345678).
 *
 * `docker compose run --rm web npm run faktury:ukazka` → `ukazka-faktur/`
 * (mimo repozitář).
 */

type Doklad = Prisma.InvoiceGetPayload<{ select: typeof VYBER_DOKLADU }>;

const VYSTUP = path.join(process.cwd(), "ukazka-faktur");

const platce: Dodavatel = {
  nazev: "Beat Stock Market s.r.o. (UKÁZKA)",
  ico: "12345678",
  dic: "CZ12345678",
  adresa: "Ukázková 1, 110 00 Praha 1",
  ucet: "123456789/0100",
  platceDph: true,
};
const neplatce: Dodavatel = { ...platce, dic: null, platceDph: false };

const firma: Odberatel = {
  nazev: "Ukázka Trading s.r.o.",
  ulice: "Vymyšlená 12",
  mesto: "Brno",
  psc: "602 00",
  zeme: "CZ",
  ico: "87654321",
  dic: "CZ87654321",
};
const osobaSAdresou: Odberatel = {
  nazev: "Jana Ukázková",
  ulice: "Smyšlená 5",
  mesto: "Ostrava",
  psc: "702 00",
  zeme: "CZ",
  ico: null,
  dic: null,
};
const osobaBezAdresy: Odberatel = {
  nazev: "Petr Vzorový",
  ulice: null,
  mesto: null,
  psc: null,
  zeme: null,
  ico: null,
  dic: null,
};

const naHalere = (castka: number) => Math.round(castka * 100) / 100;

/** Položka jako v CRM: celkem z ceny s DPH, DPH je rozdíl. */
function polozka(nazev: string, cenaBezDph: number, sazba: number, kusu = 1): PolozkaFaktury {
  const zaklad = naHalere(cenaBezDph * kusu);
  const celkem = naHalere(zaklad * (1 + sazba / 100));
  return { nazev, kusu, cenaBezDph, sazba, zaklad, dph: naHalere(celkem - zaklad), celkem };
}

const zaporna = (p: PolozkaFaktury): PolozkaFaktury => ({
  ...p,
  kusu: -p.kusu,
  zaklad: -p.zaklad,
  dph: -p.dph,
  celkem: -p.celkem,
});

const dec = (cislo: number) => new Prisma.Decimal(cislo);

function doklad(udaje: {
  cislo: string;
  objednavka: string;
  dodavatel: Dodavatel;
  odberatel: Odberatel;
  polozky: PolozkaFaktury[];
  dobropis?: string;
}): Doklad {
  const soucet = (klic: "zaklad" | "dph" | "celkem") =>
    naHalere(udaje.polozky.reduce((s, p) => s + p[klic], 0));
  const celkem = soucet("celkem");
  const bezAdresy = !udaje.odberatel.ulice && !udaje.odberatel.mesto;
  return {
    id: udaje.cislo,
    number: udaje.cislo,
    kind: udaje.dobropis ? "DOBROPIS" : "FAKTURA",
    issuedAt: new Date("2026-10-20T10:00:00+02:00"),
    taxableAt: new Date("2026-10-20T10:00:00+02:00"),
    currency: "CZK",
    baseTotal: dec(soucet("zaklad")),
    vatTotal: dec(soucet("dph")),
    total: dec(celkem),
    simplified:
      !udaje.dobropis && udaje.dodavatel.platceDph && bezAdresy && Math.abs(celkem) <= 10_000,
    supplier: udaje.dodavatel,
    customer: udaje.odberatel,
    items: udaje.polozky,
    corrects: udaje.dobropis ? { number: udaje.dobropis } : null,
    order: { number: udaje.objednavka },
  } as Doklad;
}

const clenstvi = polozka("Roční členství", 9900, 21);

const doklady = [
  doklad({
    cislo: "FV-2026-0001",
    objednavka: "2026-0101",
    dodavatel: platce,
    odberatel: firma,
    polozky: [clenstvi],
  }),
  doklad({
    cislo: "FV-2026-0002",
    objednavka: "2026-0102",
    dodavatel: platce,
    odberatel: osobaBezAdresy,
    polozky: [polozka("Kurz Základy investování", 2500, 21)],
  }),
  doklad({
    cislo: "FV-2026-0003",
    objednavka: "2026-0103",
    dodavatel: platce,
    odberatel: osobaSAdresou,
    polozky: [
      polozka("Konzultace 60 minut", 1650, 21),
      polozka("E-kniha Deník investora", 357.14, 12),
    ],
  }),
  doklad({
    cislo: "DB-2026-0001",
    objednavka: "2026-0101",
    dodavatel: platce,
    odberatel: firma,
    polozky: [zaporna(clenstvi)],
    dobropis: "FV-2026-0001",
  }),
  doklad({
    cislo: "FV-2026-0004",
    objednavka: "2026-0104",
    dodavatel: neplatce,
    odberatel: osobaSAdresou,
    polozky: [polozka("Roční členství", 9900, 0)],
  }),
];

async function vyrob() {
  mkdirSync(VYSTUP, { recursive: true });

  for (const d of doklady) {
    const pdf = await vytvorPdfDokladu({
      cislo: d.number,
      dobropis: d.kind === "DOBROPIS",
      opravuje: d.corrects?.number ?? null,
      zjednoduseny: d.simplified,
      objednavka: d.order.number,
      vystaveno: d.issuedAt,
      plneni: d.taxableAt,
      mena: d.currency,
      dodavatel: d.supplier as Dodavatel,
      odberatel: d.customer as Odberatel,
      polozky: d.items as PolozkaFaktury[],
      zaklad: d.baseTotal.toNumber(),
      dph: d.vatTotal.toNumber(),
      celkem: d.total.toNumber(),
    });
    writeFileSync(path.join(VYSTUP, `${d.number}.pdf`), pdf);
    writeFileSync(path.join(VYSTUP, `${d.number}.isdoc`), isdocXml(d));
  }

  // Pohoda a CSV jen za plátce — neplátce je ukázka PDF, ne druhá firma.
  const zaPlatce = doklady.filter((d) => (d.supplier as Dodavatel).platceDph);
  writeFileSync(path.join(VYSTUP, "pohoda.xml"), pohodaXml(zaPlatce, platce.ico));
  writeFileSync(path.join(VYSTUP, "faktury.csv"), csvFaktur(zaPlatce));

  console.log(`Hotovo: ${doklady.length} dokladů v ${VYSTUP}`);
}

void vyrob();
