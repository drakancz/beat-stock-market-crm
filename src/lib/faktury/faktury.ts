import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { cenaPolozkyBezDph, cenaPolozkySDph } from "@/lib/dph";
import { denParam, posunDne, zacatekDne } from "@/lib/obdobi";
import { precti } from "@/lib/parametry";
import { dnesniZacatek } from "@/lib/platnost";

/**
 * Faktury a dobropisy (Jakub, 19. 10. 2026). Firma je plátce DPH — faktura
 * je daňový doklad.
 *
 * | Kdo           | Smí                                                       |
 * | ------------- | --------------------------------------------------------- |
 * | klient        | stáhnout své faktury v klientské části                    |
 * | uživatel      | vidět a stáhnout faktury, export pro účetnictví           |
 * | administrátor | navíc dobropis a ruční vystavení u starší objednávky      |
 *
 * - **Vzniká sama po zaplacení** (`zmenStavPlatby()`), jen jednou na
 *   objednávku (`@@unique([orderId, kind])`). Objednávky zaplacené před
 *   spuštěním fakturu nedostanou — administrátor ji vystaví ručně.
 * - **Doklad se nemění ani nemaže.** Údaje dodavatele, odběratele a položky
 *   se při vystavení opíšou, oprava = dobropis.
 * - **Částky sedí s tím, co klient zaplatil**: celkem s DPH je součet cen
 *   s DPH ze chvíle objednávky (po slevě), základ z cen bez DPH, DPH je
 *   rozdíl — po sazbách.
 * - Bez adresy odběratele do 10 000 Kč s DPH = **zjednodušený daňový doklad**.
 *
 * **Šablonu má zkontrolovat účetní** — Claude není daňový poradce.
 */

/** Zjednodušený daňový doklad smí být nejvýš na tuto částku s DPH. */
export const LIMIT_ZJEDNODUSENEHO = 10_000;

export const dodavatelSchema = z.object({
  nazev: z.string(),
  ico: z.string().nullable(),
  dic: z.string().nullable(),
  adresa: z.string().nullable(),
  ucet: z.string().nullable(),
  platceDph: z.boolean(),
});

export const odberatelSchema = z.object({
  nazev: z.string(),
  ulice: z.string().nullable(),
  mesto: z.string().nullable(),
  psc: z.string().nullable(),
  zeme: z.string().nullable(),
  ico: z.string().nullable(),
  dic: z.string().nullable(),
});

export const polozkaSchema = z.object({
  nazev: z.string(),
  kusu: z.number(),
  /** Cena za kus bez DPH. */
  cenaBezDph: z.number(),
  sazba: z.number(),
  zaklad: z.number(),
  dph: z.number(),
  celkem: z.number(),
});

export type Dodavatel = z.infer<typeof dodavatelSchema>;
export type Odberatel = z.infer<typeof odberatelSchema>;
export type PolozkaFaktury = z.infer<typeof polozkaSchema>;

const naHalere = (castka: number) => Math.round(castka * 100) / 100;

/** Rozpis DPH podle sazeb — pro PDF i exporty. */
export function rozpisDph(polozky: PolozkaFaktury[]) {
  const sazby = new Map<number, { zaklad: number; dph: number; celkem: number }>();
  for (const p of polozky) {
    const radek = sazby.get(p.sazba) ?? { zaklad: 0, dph: 0, celkem: 0 };
    radek.zaklad = naHalere(radek.zaklad + p.zaklad);
    radek.dph = naHalere(radek.dph + p.dph);
    radek.celkem = naHalere(radek.celkem + p.celkem);
    sazby.set(p.sazba, radek);
  }
  return [...sazby.entries()]
    .sort(([a], [b]) => b - a)
    .map(([sazba, soucty]) => ({ sazba, ...soucty }));
}

/** Uložený doklad s přečtenými opisy. Co neprojde schématem, je prázdné. */
export function prectiDoklad(ulozeny: { supplier: unknown; customer: unknown; items: unknown }) {
  const dodavatel = dodavatelSchema.safeParse(ulozeny.supplier);
  const odberatel = odberatelSchema.safeParse(ulozeny.customer);
  const polozky = z.array(polozkaSchema).safeParse(ulozeny.items);
  return {
    dodavatel: dodavatel.success ? dodavatel.data : null,
    odberatel: odberatel.success ? odberatel.data : null,
    polozky: polozky.success ? polozky.data : [],
  };
}

/**
 * Jsou v Nastavení → Firma údaje, bez kterých faktura nejde vystavit?
 * IČO a sídlo vždy, DIČ jen u plátce DPH. Dokud nejsou, faktury se
 * nevystavují (ani samy, ani ručně) a CRM na to upozorní.
 */
export function udajeFirmyKFakture(firma: {
  ico: string | null;
  dic: string | null;
  address: string | null;
  vatPayer: boolean;
}): { ok: true } | { ok: false; chybi: string[] } {
  const chybi = [
    !firma.ico?.trim() && "IČO",
    !firma.address?.trim() && "sídlo",
    firma.vatPayer && !firma.dic?.trim() && "DIČ",
  ].filter((x): x is string => Boolean(x));
  return chybi.length === 0 ? { ok: true } : { ok: false, chybi };
}

/** Totéž nad uloženým nastavením — pro upozornění a ruční vystavení. */
export async function fakturyZapnute(): Promise<{ ok: true } | { ok: false; chybi: string[] }> {
  const firma = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: { ico: true, dic: true, address: true, vatPayer: true },
  });
  return firma ? udajeFirmyKFakture(firma) : { ok: false, chybi: ["IČO", "sídlo"] };
}

function jeChybaJedinecnosti(chyba: unknown): boolean {
  return !!chyba && typeof chyba === "object" && "code" in chyba && chyba.code === "P2002";
}

/**
 * Vystaví fakturu k zaplacené objednávce, nebo vrátí tu, co už má. Vrací
 * `null`, když objednávka zaplacená není. `kdo` = administrátor u ručního
 * vystavení, jinak `null` (CRM samo po zaplacení).
 */
export async function vystavFakturu(
  orderId: string,
  kdo: string | null,
): Promise<{ id: string; number: string; nova: boolean } | null> {
  const existujici = await db.invoice.findUnique({
    where: { orderId_kind: { orderId, kind: "FAKTURA" } },
    select: { id: true, number: true },
  });
  if (existujici) return { ...existujici, nova: false };

  const [objednavka, firma] = await Promise.all([
    db.order.findFirst({
      where: { id: orderId, status: "ZAPLACENO", deletedAt: null, paidAt: { not: null } },
      select: {
        id: true,
        number: true,
        currency: true,
        paidAt: true,
        client: {
          select: {
            name: true,
            billingName: true,
            billingStreet: true,
            billingCity: true,
            billingZip: true,
            billingCountry: true,
            billingIco: true,
            billingDic: true,
          },
        },
        items: {
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: {
              select: { name: true, netPrice: true, vatRate: { select: { rate: true } } },
            },
          },
        },
      },
    }),
    db.companySettings.findUnique({
      where: { id: "firma" },
      select: {
        companyName: true,
        ico: true,
        dic: true,
        address: true,
        bankAccount: true,
        vatPayer: true,
      },
    }),
  ]);
  if (!objednavka || objednavka.items.length === 0) return null;

  // Pojistka (Jakub, 19. 10. 2026): bez IČO a sídla (u plátce i DIČ) se
  // faktura nevystaví — daňový doklad bez dodavatele by nešel opravit.
  if (!firma || !udajeFirmyKFakture(firma).ok) return null;
  const platceDph = firma.vatPayer;
  const dodavatel: Dodavatel = {
    nazev: firma.companyName,
    ico: firma.ico,
    dic: platceDph ? firma.dic : null,
    adresa: firma.address,
    ucet: firma.bankAccount,
    platceDph,
  };
  const k = objednavka.client;
  const odberatel: Odberatel = {
    nazev: k.billingName || k.name,
    ulice: k.billingStreet,
    mesto: k.billingCity,
    psc: k.billingZip,
    zeme: k.billingCountry,
    ico: k.billingIco,
    dic: k.billingDic,
  };

  const polozky: PolozkaFaktury[] = objednavka.items.map((p) => {
    const celkem = naHalere(cenaPolozkySDph(p) * p.quantity);
    const zaklad = platceDph ? naHalere(cenaPolozkyBezDph(p) * p.quantity) : celkem;
    return {
      nazev: p.product.name,
      kusu: p.quantity,
      cenaBezDph: platceDph ? cenaPolozkyBezDph(p) : cenaPolozkySDph(p),
      sazba: platceDph ? (p.vatPercent?.toNumber() ?? p.product.vatRate.rate.toNumber()) : 0,
      zaklad,
      dph: naHalere(celkem - zaklad),
      celkem,
    };
  });
  const celkem = naHalere(polozky.reduce((s, p) => s + p.celkem, 0));
  const zaklad = naHalere(polozky.reduce((s, p) => s + p.zaklad, 0));
  const bezAdresy = !odberatel.ulice || !odberatel.mesto || !odberatel.psc;

  try {
    const faktura = await db.$transaction(async (tx) => {
      const nova = await tx.invoice.create({
        data: {
          kind: "FAKTURA",
          orderId: objednavka.id,
          taxableAt: objednavka.paidAt!,
          currency: objednavka.currency,
          baseTotal: zaklad,
          vatTotal: naHalere(celkem - zaklad),
          total: celkem,
          simplified: bezAdresy && celkem <= LIMIT_ZJEDNODUSENEHO,
          supplier: dodavatel as Prisma.InputJsonObject,
          customer: odberatel as Prisma.InputJsonObject,
          items: polozky as unknown as Prisma.InputJsonArray,
          createdById: kdo,
        },
        select: { id: true, number: true },
      });
      await zapisDoAuditu(tx, {
        userId: kdo,
        entity: "orders",
        entityId: objednavka.id,
        action: "faktura.vystavena",
        after: { cislo: nova.number, objednavka: objednavka.number, celkem },
      });
      return nova;
    });
    return { ...faktura, nova: true };
  } catch (chyba) {
    // Souběžné vystavení — fakturu mezitím vystavil jiný požadavek.
    if (!jeChybaJedinecnosti(chyba)) throw chyba;
    const uz = await db.invoice.findUnique({
      where: { orderId_kind: { orderId, kind: "FAKTURA" } },
      select: { id: true, number: true },
    });
    return uz ? { ...uz, nova: false } : null;
  }
}

/**
 * Dobropis k faktuře — **jen administrátor** (kontroluje volající). Opíše
 * položky se zápornými částkami, datum plnění je den vystavení. Ke každé
 * faktuře nejvýš jeden.
 */
export async function vystavDobropis(
  fakturaId: string,
  adminId: string,
): Promise<{ ok: true; number: string } | { ok: false; chyba: string }> {
  const faktura = await db.invoice.findFirst({
    where: { id: fakturaId, kind: "FAKTURA" },
    select: {
      id: true,
      number: true,
      orderId: true,
      currency: true,
      baseTotal: true,
      vatTotal: true,
      total: true,
      supplier: true,
      customer: true,
      items: true,
    },
  });
  if (!faktura) return { ok: false, chyba: "Taková faktura neexistuje." };

  const { polozky } = prectiDoklad(faktura);
  const zaporne = polozky.map((p) => ({
    ...p,
    kusu: -p.kusu,
    zaklad: -p.zaklad,
    dph: -p.dph,
    celkem: -p.celkem,
  }));

  try {
    const dobropis = await db.$transaction(async (tx) => {
      const novy = await tx.invoice.create({
        data: {
          kind: "DOBROPIS",
          orderId: faktura.orderId,
          correctsId: faktura.id,
          taxableAt: new Date(),
          currency: faktura.currency,
          baseTotal: faktura.baseTotal.negated(),
          vatTotal: faktura.vatTotal.negated(),
          total: faktura.total.negated(),
          supplier: faktura.supplier as Prisma.InputJsonValue,
          customer: faktura.customer as Prisma.InputJsonValue,
          items: zaporne as unknown as Prisma.InputJsonArray,
          createdById: adminId,
        },
        select: { number: true },
      });
      await zapisDoAuditu(tx, {
        userId: adminId,
        entity: "orders",
        entityId: faktura.orderId,
        action: "faktura.dobropis",
        after: { cislo: novy.number, faktura: faktura.number },
      });
      return novy;
    });
    return { ok: true, number: dobropis.number };
  } catch (chyba) {
    if (jeChybaJedinecnosti(chyba)) {
      return { ok: false, chyba: "K téhle faktuře už dobropis je." };
    }
    throw chyba;
  }
}

/** Výběr dokladu pro PDF a exporty. */
export const VYBER_DOKLADU = {
  id: true,
  number: true,
  kind: true,
  issuedAt: true,
  taxableAt: true,
  currency: true,
  baseTotal: true,
  vatTotal: true,
  total: true,
  simplified: true,
  supplier: true,
  customer: true,
  items: true,
  corrects: { select: { number: true } },
  order: { select: { number: true } },
} as const;

type UlozenyDoklad = Prisma.InvoiceGetPayload<{ select: typeof VYBER_DOKLADU }>;

/** PDF uloženého dokladu — z opisů ve chvíli vystavení. */
export async function pdfDokladu(doklad: UlozenyDoklad): Promise<Buffer | null> {
  const { vytvorPdfDokladu } = await import("./pdf");
  const { dodavatel, odberatel, polozky } = prectiDoklad(doklad);
  if (!dodavatel || !odberatel) return null;
  return vytvorPdfDokladu({
    cislo: doklad.number,
    dobropis: doklad.kind === "DOBROPIS",
    opravuje: doklad.corrects?.number ?? null,
    zjednoduseny: doklad.simplified,
    objednavka: doklad.order.number,
    vystaveno: doklad.issuedAt,
    plneni: doklad.taxableAt,
    mena: doklad.currency,
    dodavatel,
    odberatel,
    polozky,
    zaklad: doklad.baseTotal.toNumber(),
    dph: doklad.vatTotal.toNumber(),
    celkem: doklad.total.toNumber(),
  });
}

/** Odpověď se souborem PDF — stažení, ne zobrazení v cizí stránce. */
export function odpovedPdf(pdf: Buffer, cislo: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${cislo}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Období pro seznam a export faktur z adresy (`?od=RRRR-MM-DD&do=…`).
 * Výchozí je aktuální měsíc v pražském čase. `do` platí celý den.
 */
export function obdobiFaktur(parametry: Record<string, string | string[] | undefined>) {
  const vstup = precti(z.object({ od: denParam, do: denParam }), parametry);
  const dnes = dnesniZacatek();
  const [rok, mesic] = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
  })
    .format(dnes)
    .split("-")
    .map(Number) as [number, number];
  const od = vstup.od ?? zacatekDne(rok, mesic, 1);
  const doDne = vstup.do ?? dnes;
  return { od, do: doDne, doVcetne: posunDne(doDne, 1) };
}
