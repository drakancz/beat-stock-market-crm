import { randomUUID } from "node:crypto";

import { cisloCsv, sestavCsv } from "@/lib/csv";

import { prectiDoklad, rozpisDph, type VYBER_DOKLADU } from "./faktury";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Export faktur pro účetnictví (Jakub vybral 19. 10. 2026): CSV a Pohoda
 * XML za období, ISDOC u každé faktury zvlášť.
 *
 * **Pohodu ověřit zkušebním importem a ISDOC validátorem** (isdoc.cz) — tvar
 * je podle veřejných specifikací, v kontejneru je ověřit nejde. Exportuje
 * se jen to, co je na dokladu (opisy ze chvíle vystavení), žádné kontakty.
 */

type Doklad = Prisma.InvoiceGetPayload<{ select: typeof VYBER_DOKLADU }>;

const den = (datum: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(datum);

const castka = (cislo: number) => cislo.toFixed(2);

/** Text do XML — bez znaků, které by rozbily strukturu. */
function xml(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Variabilní symbol: číslice z čísla dokladu (FV-2026-0012 → 20260012). */
const variabilni = (cislo: string) => cislo.replace(/\D/g, "").slice(0, 10);

/* ---------- CSV ---------- */

export function csvFaktur(doklady: Doklad[]): string {
  const sazby = [21, 12, 0];
  return sestavCsv([
    [
      "Číslo",
      "Druh",
      "Opravuje",
      "Objednávka",
      "Vystaveno",
      "Datum plnění",
      "Odběratel",
      "IČO odběratele",
      "DIČ odběratele",
      ...sazby.flatMap((s) => [`Základ ${s} %`, `DPH ${s} %`]),
      "Základ celkem",
      "DPH celkem",
      "Celkem",
      "Měna",
    ],
    ...doklady.map((d) => {
      const { odberatel, polozky } = prectiDoklad(d);
      const rozpis = new Map(rozpisDph(polozky).map((r) => [r.sazba, r]));
      return [
        d.number,
        d.kind === "DOBROPIS" ? "Dobropis" : d.simplified ? "Zjednodušený doklad" : "Faktura",
        d.corrects?.number ?? "",
        d.order.number,
        den(d.issuedAt),
        den(d.taxableAt),
        odberatel?.nazev ?? "",
        odberatel?.ico ?? "",
        odberatel?.dic ?? "",
        ...sazby.flatMap((s) => [
          cisloCsv(rozpis.get(s)?.zaklad ?? 0),
          cisloCsv(rozpis.get(s)?.dph ?? 0),
        ]),
        cisloCsv(d.baseTotal.toNumber()),
        cisloCsv(d.vatTotal.toNumber()),
        cisloCsv(d.total.toNumber()),
        d.currency,
      ];
    }),
  ]);
}

/* ---------- Pohoda XML ---------- */

/** Sazba DPH v Pohodě: základní / snížená / žádná. */
const sazbaPohody = (sazba: number) => (sazba >= 20 ? "high" : sazba > 0 ? "low" : "none");

export function pohodaXml(doklady: Doklad[], icoFirmy: string | null): string {
  const polozkyXml = (d: Doklad) =>
    prectiDoklad(d)
      .polozky.map(
        (p) => `
        <inv:invoiceItem>
          <inv:text>${xml(p.nazev)}</inv:text>
          <inv:quantity>${p.kusu}</inv:quantity>
          <inv:payVAT>false</inv:payVAT>
          <inv:rateVAT>${sazbaPohody(p.sazba)}</inv:rateVAT>
          <inv:homeCurrency>
            <typ:unitPrice>${castka(p.cenaBezDph)}</typ:unitPrice>
            <typ:price>${castka(p.zaklad)}</typ:price>
            <typ:priceVAT>${castka(p.dph)}</typ:priceVAT>
          </inv:homeCurrency>
        </inv:invoiceItem>`,
      )
      .join("");

  const polozky = doklady
    .map((d) => {
      const o = prectiDoklad(d).odberatel;
      return `
  <dat:dataPackItem version="2.0" id="${xml(d.number)}">
    <inv:invoice version="2.0">
      <inv:invoiceHeader>
        <inv:invoiceType>${d.kind === "DOBROPIS" ? "issuedCorrectiveTax" : "issuedInvoice"}</inv:invoiceType>
        <inv:number><typ:numberRequested>${xml(d.number)}</typ:numberRequested></inv:number>
        <inv:symVar>${variabilni(d.number)}</inv:symVar>
        <inv:date>${den(d.issuedAt)}</inv:date>
        <inv:dateTax>${den(d.taxableAt)}</inv:dateTax>
        <inv:dateAccounting>${den(d.issuedAt)}</inv:dateAccounting>
        <inv:text>${xml(`Objednávka ${d.order.number}`)}</inv:text>
        <inv:partnerIdentity>
          <typ:address>
            <typ:company>${xml(o?.nazev)}</typ:company>
            <typ:street>${xml(o?.ulice)}</typ:street>
            <typ:city>${xml(o?.mesto)}</typ:city>
            <typ:zip>${xml(o?.psc)}</typ:zip>
            <typ:ico>${xml(o?.ico)}</typ:ico>
            <typ:dic>${xml(o?.dic)}</typ:dic>
          </typ:address>
        </inv:partnerIdentity>
        <inv:paymentType><typ:paymentType>card</typ:paymentType></inv:paymentType>
        ${d.corrects ? `<inv:originalDocument>${xml(d.corrects.number)}</inv:originalDocument>` : ""}
      </inv:invoiceHeader>
      <inv:invoiceDetail>${polozkyXml(d)}
      </inv:invoiceDetail>
      <inv:invoiceSummary><inv:roundingDocument>none</inv:roundingDocument></inv:invoiceSummary>
    </inv:invoice>
  </dat:dataPackItem>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<dat:dataPack version="2.0" id="crm-${randomUUID().slice(0, 8)}" ico="${xml(icoFirmy)}" application="CRM Beat Stock Market" note="Faktury"
  xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"
  xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">${polozky}
</dat:dataPack>
`;
}

/* ---------- ISDOC (jedna faktura) ---------- */

export function isdocXml(d: Doklad): string {
  const { dodavatel, odberatel, polozky } = prectiDoklad(d);
  const strana = (
    nazev: string,
    ulice: string | null,
    mesto: string | null,
    psc: string | null,
    zeme: string | null,
    ico: string | null,
    dic: string | null,
  ) => `
    <Party>
      <PartyIdentification><ID>${xml(ico)}</ID></PartyIdentification>
      <PartyName><Name>${xml(nazev)}</Name></PartyName>
      <PostalAddress>
        <StreetName>${xml(ulice)}</StreetName>
        <BuildingNumber></BuildingNumber>
        <CityName>${xml(mesto)}</CityName>
        <PostalZone>${xml(psc)}</PostalZone>
        <Country><IdentificationCode>${xml(zeme ?? "CZ")}</IdentificationCode><Name></Name></Country>
      </PostalAddress>
      ${dic ? `<PartyTaxScheme><CompanyID>${xml(dic)}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>` : ""}
    </Party>`;

  const radky = polozky
    .map(
      (p, i) => `
    <InvoiceLine>
      <ID>${i + 1}</ID>
      <InvoicedQuantity unitCode="ks">${p.kusu}</InvoicedQuantity>
      <LineExtensionAmount>${castka(p.zaklad)}</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>${castka(p.celkem)}</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>${castka(p.dph)}</LineExtensionTaxAmount>
      <UnitPrice>${castka(p.cenaBezDph)}</UnitPrice>
      <UnitPriceTaxInclusive>${castka(p.kusu ? p.celkem / p.kusu : 0)}</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory>
        <Percent>${p.sazba}</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </ClassifiedTaxCategory>
      <Item><Description>${xml(p.nazev)}</Description></Item>
    </InvoiceLine>`,
    )
    .join("");

  const rozpis = rozpisDph(polozky)
    .map(
      (r) => `
    <TaxSubTotal>
      <TaxableAmount>${castka(r.zaklad)}</TaxableAmount>
      <TaxAmount>${castka(r.dph)}</TaxAmount>
      <TaxInclusiveAmount>${castka(r.celkem)}</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>${castka(r.zaklad)}</DifferenceTaxableAmount>
      <DifferenceTaxAmount>${castka(r.dph)}</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>${castka(r.celkem)}</DifferenceTaxInclusiveAmount>
      <TaxCategory><Percent>${r.sazba}</Percent></TaxCategory>
    </TaxSubTotal>`,
    )
    .join("");

  const zaklad = d.baseTotal.toNumber();
  const celkem = d.total.toNumber();
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${d.kind === "DOBROPIS" ? 2 : 1}</DocumentType>
  <ID>${xml(d.number)}</ID>
  <UUID>${randomUUID().toUpperCase()}</UUID>
  <IssueDate>${den(d.issuedAt)}</IssueDate>
  <TaxPointDate>${den(d.taxableAt)}</TaxPointDate>
  <VATApplicable>${dodavatel?.platceDph ? "true" : "false"}</VATApplicable>
  <Note>${xml(`Objednávka ${d.order.number}`)}</Note>
  <LocalCurrencyCode>${xml(d.currency)}</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  ${d.corrects ? `<OriginalDocumentReferences><OriginalDocumentReference><ID>${xml(d.corrects.number)}</ID></OriginalDocumentReference></OriginalDocumentReferences>` : ""}
  <AccountingSupplierParty>${strana(
    dodavatel?.nazev ?? "",
    dodavatel?.adresa ?? null,
    null,
    null,
    "CZ",
    dodavatel?.ico ?? null,
    dodavatel?.dic ?? null,
  )}
  </AccountingSupplierParty>
  <AccountingCustomerParty>${strana(
    odberatel?.nazev ?? "",
    odberatel?.ulice ?? null,
    odberatel?.mesto ?? null,
    odberatel?.psc ?? null,
    odberatel?.zeme ?? null,
    odberatel?.ico ?? null,
    odberatel?.dic ?? null,
  )}
  </AccountingCustomerParty>
  <InvoiceLines>${radky}
  </InvoiceLines>
  <TaxTotal>${rozpis}
    <TaxAmount>${castka(d.vatTotal.toNumber())}</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>${castka(zaklad)}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${castka(celkem)}</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>${castka(zaklad)}</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>${castka(celkem)}</DifferenceTaxInclusiveAmount>
    <PayableRoundingAmount>0</PayableRoundingAmount>
    <PaidDepositsAmount>${castka(celkem)}</PaidDepositsAmount>
    <PayableAmount>0</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>
`;
}
