import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { posunDne, type Obdobi } from "@/lib/obdobi";
import { dnesniZacatek, pridejMesice, zacatekDneOkamziku } from "@/lib/platnost";
import { viditelniKlienti } from "@/lib/queries";
import type { Viewer } from "@/lib/session";
import { DRUHY_BEZ_PLATNOSTI } from "@/lib/types";

/**
 * Čísla členství na Dashboardu (Jakub, 10. 10. 2026 — první funkce
 * z rešerše inspirace).
 *
 * **Vidí každý přihlášený** (Jakub), stejně jako tržby a trychtýř.
 * Omezení je v dotazu přes `viditelniKlienti()`. Členství = produkt
 * s platností (`maPlatnost()`); kurz a konzultace se nepočítají.
 *
 * **Prodloužení a odchody se skládají z plateb**, stejně jako platnost
 * (`spocitejKonec()` v `platnost.ts`): další platba navazuje na konec,
 * když přišla nejpozději **14 dní po konci** (Jakub: `LHUTA_DNU`) —
 * pak je to prodloužení. Pozdější platba je návrat a předchozí konec se
 * počítá jako odchod. Konec, u kterého lhůta ještě běží a platba nepřišla,
 * „čeká na rozhodnutí“.
 *
 * **Ruční úpravy konce** (administrátor na kartě klienta) se do historie
 * prodloužení nepočítají. Aktivní členové a měsíční příjem ale berou
 * skutečnou platnost z `product_validities`, takže v nich ruční úpravy jsou.
 *
 * Všechny částky jsou bez DPH (jako všude v CRM). Smazané objednávky se
 * nepočítají.
 */

/** Kolik dní po konci se ještě počítá platba jako prodloužení. */
export const LHUTA_DNU = 14;

export interface CislaClenstvi {
  /** Klienti s dnes platným členstvím. */
  aktivniClenove: number;
  /** Součet měsíční ceny běžících členství, bez DPH. */
  mesicniPrijem: number;
  /** Konce členství v období: prodloužilo, odešlo, ještě se neví. */
  prodlouzilo: number;
  odeslo: number;
  cekaNaRozhodnuti: number;
  /** Klienti, kteří si v období poprvé koupili členství. */
  noviClenove: number;
  /** Průměrná zaplacená částka na klienta, který kdy něco zaplatil, bez DPH. */
  prumernaUtrata: number;
  platicichKlientu: number;
}

interface Platba {
  den: Date;
  mesicu: number;
}

export interface UdalostKonce {
  konec: Date;
  vysledek: "prodlouzeno" | "odesel" | "ceka";
}

/**
 * Konce jednoho členství (klient + produkt) podle plateb. Čistá funkce —
 * kvůli přehlednosti a aby šla zkoušet bez databáze.
 */
export function koncePodlePlateb(platby: Platba[], dnes: Date): UdalostKonce[] {
  const serazene = [...platby].sort((a, b) => a.den.getTime() - b.den.getTime());
  const udalosti: UdalostKonce[] = [];
  let konec: Date | null = null;

  for (const platba of serazene) {
    if (platba.mesicu <= 0) continue;
    let zacatek = platba.den;

    if (konec) {
      if (platba.den.getTime() <= posunDne(konec, LHUTA_DNU).getTime()) {
        // Navázal: zaplatil před koncem, nebo do lhůty po něm.
        udalosti.push({ konec, vysledek: "prodlouzeno" });
        if (konec.getTime() > platba.den.getTime()) zacatek = konec;
      } else {
        udalosti.push({ konec, vysledek: "odesel" });
      }
    }
    konec = pridejMesice(zacatek, platba.mesicu);
  }

  // Poslední konec: běží dál, čeká na lhůtu, nebo je to odchod.
  if (konec && konec.getTime() < dnes.getTime()) {
    const lhutaUplynula = posunDne(konec, LHUTA_DNU).getTime() < dnes.getTime();
    udalosti.push({ konec, vysledek: lhutaUplynula ? "odesel" : "ceka" });
  }
  return udalosti;
}

export async function nactiCislaClenstvi(viewer: Viewer, obdobi: Obdobi): Promise<CislaClenstvi> {
  const dnes = dnesniZacatek();
  const zaplacene = {
    status: "ZAPLACENO" as const,
    deletedAt: null,
    paidAt: { not: null },
    client: viditelniKlienti(viewer),
  };

  const [polozky, bezici, utraty] = await Promise.all([
    // Zaplacené položky členství — z nich se skládá historie.
    db.orderItem.findMany({
      where: { order: zaplacene, product: { kind: { notIn: DRUHY_BEZ_PLATNOSTI } } },
      select: {
        productId: true,
        quantity: true,
        validityMonths: true,
        netPrice: true,
        vatPercent: true,
        product: { select: { validityMonths: true, netPrice: true } },
        order: { select: { clientId: true, paidAt: true } },
      },
    }),
    db.productValidity.findMany({
      where: {
        validUntil: { gte: dnes },
        client: viditelniKlienti(viewer),
        product: { kind: { notIn: DRUHY_BEZ_PLATNOSTI } },
      },
      select: { clientId: true, productId: true },
    }),
    // Všechno zaplacené, i kurzy a konzultace — kvůli průměrné útratě.
    db.orderItem.findMany({
      where: { order: zaplacene },
      select: {
        quantity: true,
        netPrice: true,
        vatPercent: true,
        product: { select: { netPrice: true } },
        order: { select: { clientId: true } },
      },
    }),
  ]);

  // Platby po členstvích a poslední cena za měsíc u každého z nich.
  const platby = new Map<string, Platba[]>();
  const posledniCena = new Map<string, { den: Date; zaMesic: number }>();
  const prvniPlatbaKlienta = new Map<string, Date>();

  for (const polozka of polozky) {
    const mesicuZaKus = polozka.validityMonths ?? polozka.product.validityMonths ?? 0;
    const paidAt = polozka.order.paidAt;
    if (mesicuZaKus <= 0 || !paidAt) continue;

    const klic = `${polozka.order.clientId}:${polozka.productId}`;
    const den = zacatekDneOkamziku(paidAt);
    platby.set(klic, [
      ...(platby.get(klic) ?? []),
      { den, mesicu: mesicuZaKus * polozka.quantity },
    ]);

    const posledni = posledniCena.get(klic);
    if (!posledni || posledni.den.getTime() <= den.getTime()) {
      posledniCena.set(klic, { den, zaMesic: cenaPolozkyBezDph(polozka) / mesicuZaKus });
    }

    const prvni = prvniPlatbaKlienta.get(polozka.order.clientId);
    if (!prvni || paidAt.getTime() < prvni.getTime()) {
      prvniPlatbaKlienta.set(polozka.order.clientId, paidAt);
    }
  }

  let prodlouzilo = 0;
  let odeslo = 0;
  let cekaNaRozhodnuti = 0;
  for (const seznam of platby.values()) {
    for (const udalost of koncePodlePlateb(seznam, dnes)) {
      const t = udalost.konec.getTime();
      if (t < obdobi.od.getTime() || t >= obdobi.do.getTime()) continue;
      if (udalost.vysledek === "prodlouzeno") prodlouzilo++;
      else if (udalost.vysledek === "odesel") odeslo++;
      else cekaNaRozhodnuti++;
    }
  }

  const noviClenove = [...prvniPlatbaKlienta.values()].filter(
    (kdy) => kdy.getTime() >= obdobi.od.getTime() && kdy.getTime() < obdobi.do.getTime(),
  ).length;

  const mesicniPrijem = bezici.reduce(
    (soucet, radek) =>
      soucet + (posledniCena.get(`${radek.clientId}:${radek.productId}`)?.zaMesic ?? 0),
    0,
  );

  const naKlienta = new Map<string, number>();
  for (const polozka of utraty) {
    const klient = polozka.order.clientId;
    naKlienta.set(
      klient,
      (naKlienta.get(klient) ?? 0) + polozka.quantity * cenaPolozkyBezDph(polozka),
    );
  }
  const celkem = [...naKlienta.values()].reduce((soucet, castka) => soucet + castka, 0);

  return {
    aktivniClenove: new Set(bezici.map((radek) => radek.clientId)).size,
    mesicniPrijem: Math.round(mesicniPrijem),
    prodlouzilo,
    odeslo,
    cekaNaRozhodnuti,
    noviClenove,
    prumernaUtrata: naKlienta.size ? Math.round(celkem / naKlienta.size) : 0,
    platicichKlientu: naKlienta.size,
  };
}

/** Míra prodloužení v procentech z rozhodnutých konců; `null` = nic neskončilo. */
export function miraProdlouzeni(cisla: Pick<CislaClenstvi, "prodlouzilo" | "odeslo">) {
  const rozhodnuto = cisla.prodlouzilo + cisla.odeslo;
  return rozhodnuto === 0 ? null : Math.round((cisla.prodlouzilo / rozhodnuto) * 100);
}
