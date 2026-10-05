import type { Metadata } from "next";

import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { requireAdmin } from "@/lib/session";
import { formatDatumCas, formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { OUTCOME_LABEL } from "@/lib/types";

import { SeznamSmazanych, type RadekKose } from "./seznam-smazanych";

export const metadata: Metadata = { title: "Smazané" };

export const dynamic = "force-dynamic";

/**
 * Společný koš — jen pro administrátora.
 *
 * Sbíhá se sem všechno odložené: klienti, objednávky, hovory, portfolia,
 * produkty, brokeři i účty.
 * Záznam se nikde jinde nezobrazuje, ale v databázi zůstává i s historií,
 * takže se dá vrátit přesně tam, odkud zmizel.
 *
 * `requireAdmin()` vrací 404, takže pro nepovolaného tahle obrazovka
 * neexistuje — ani když zná adresu.
 */
export default async function SmazanePage() {
  await requireAdmin();

  const [klienti, objednavky, hovory, portfolia, produkty, brokeri, uzivatele] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        deletedAt: true,
        mergedInto: { select: { name: true } },
        _count: {
          select: {
            calls: true,
            tasks: true,
            portfolios: true,
            activities: true,
            orders: true,
            zpravy: true,
            // Účast na webinářích (3C) je taky historie.
            ucastNaWebinarich: true,
          },
        },
      },
    }),
    db.order.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        number: true,
        currency: true,
        deletedAt: true,
        client: { select: { name: true } },
        items: {
          select: {
            quantity: true,
            netPrice: true,
            vatPercent: true,
            product: { select: { netPrice: true } },
          },
        },
      },
    }),
    db.call.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        at: true,
        durationMin: true,
        outcome: true,
        deletedAt: true,
        client: { select: { name: true } },
        user: { select: { name: true } },
        order: { select: { number: true } },
      },
    }),
    db.portfolio.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        currency: true,
        deletedAt: true,
        client: { select: { name: true } },
        broker: { select: { name: true } },
        _count: { select: { positions: true } },
      },
    }),
    db.product.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        _count: { select: { orders: true, calls: true, platnosti: true, kurzy: true } },
      },
    }),
    db.broker.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        _count: { select: { portfolios: true } },
      },
    }),
    db.user.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        deletedAt: true,
        _count: {
          select: { calls: true, tasks: true, auditLog: true, events: true },
        },
      },
    }),
  ]);

  const radky: RadekKose[] = [
    ...klienti.map((klient) => {
      const { calls, tasks, portfolios, activities, orders, zpravy, ucastNaWebinarich } =
        klient._count;
      return {
        druh: "klient" as const,
        id: klient.id,
        nazev: klient.name,
        popis: klient.mergedInto
          ? `${klient.email} — sloučeno do karty ${klient.mergedInto.name}`
          : klient.email,
        smazano: klient.deletedAt!.toISOString(),
        maHistorii:
          klient.mergedInto !== null ||
          calls > 0 ||
          tasks > 0 ||
          portfolios > 0 ||
          activities > 0 ||
          orders > 0 ||
          zpravy > 0 ||
          ucastNaWebinarich > 0,
        procNejde: klient.mergedInto
          ? "Sloučená karta — podle ní se objednávky zapisují ke správnému klientovi."
          : "Má v systému objednávky, hovory, úkoly, portfolia, zprávy nebo účast na webinářích.",
      };
    }),
    ...objednavky.map((objednavka) => ({
      druh: "objednavka" as const,
      id: objednavka.id,
      nazev: `Objednávka ${objednavka.number}`,
      // Cena bez DPH, stejně jako všude jinde v systému.
      popis: `${objednavka.client.name}, ${formatMoney(
        objednavka.items.reduce(
          (soucet, polozka) => soucet + polozka.quantity * cenaPolozkyBezDph(polozka),
          0,
        ),
        objednavka.currency,
      )} bez DPH`,
      smazano: objednavka.deletedAt!.toISOString(),
      // Objednávka po sobě v systému nic nenechává — objednané produkty
      // se mažou s ní a v auditním logu zůstává stopa i po trvalém
      // smazání.
      maHistorii: false,
      procNejde: "",
    })),
    ...hovory.map((hovor) => ({
      druh: "hovor" as const,
      id: hovor.id,
      nazev: `${OUTCOME_LABEL[hovor.outcome]} — ${hovor.client.name}`,
      popis: [
        formatDatumCas(hovor.at),
        `${hovor.durationMin} min`,
        `zapsal ${hovor.user.name}`,
        hovor.order ? `objednávka ${hovor.order.number}` : null,
      ]
        .filter(Boolean)
        .join(", "),
      smazano: hovor.deletedAt!.toISOString(),
      // Na hovoru nic nevisí — smazat nadobro jde vždycky. Stopa po něm
      // zůstane v auditním logu.
      maHistorii: false,
      procNejde: "",
    })),
    ...portfolia.map((portfolio) => ({
      druh: "portfolio" as const,
      id: portfolio.id,
      nazev: `${portfolio.client.name} — ${portfolio.broker.name}`,
      popis: `${portfolio.currency}, ${pocet(portfolio._count.positions, "pozice", "pozice", "pozic")}`,
      smazano: portfolio.deletedAt!.toISOString(),
      maHistorii: false,
      procNejde: "",
    })),
    ...produkty.map((produkt) => {
      const { orders, calls, platnosti, kurzy } = produkt._count;
      return {
        druh: "produkt" as const,
        id: produkt.id,
        nazev: produkt.name,
        popis:
          orders > 0
            ? `v ${pocet(orders, "objednávce", "objednávkách", "objednávkách")}`
            : "nikdo ho neobjednal",
        smazano: produkt.deletedAt!.toISOString(),
        // Objednávky, platnost i hovory na produkt odkazují — kdyby zmizel,
        // z historie by se ztratilo, co si klient koupil.
        maHistorii: orders > 0 || calls > 0 || platnosti > 0 || kurzy > 0,
        procNejde: "Je v objednávkách, platnosti členství, u hovoru nebo má obsah kurzu.",
      };
    }),
    ...brokeri.map((broker) => ({
      druh: "broker" as const,
      id: broker.id,
      nazev: broker.name,
      popis: pocet(broker._count.portfolios, "portfolio", "portfolia", "portfolií"),
      smazano: broker.deletedAt!.toISOString(),
      // Objednávky brokera nedrží — od 22. 9. 2026 se u nich nevede.
      maHistorii: broker._count.portfolios > 0,
      procNejde: "Používá se u portfolií klientů.",
    })),
    ...uzivatele.map((uzivatel) => {
      const { calls, tasks, auditLog, events } = uzivatel._count;
      return {
        druh: "uzivatel" as const,
        id: uzivatel.id,
        nazev: uzivatel.name,
        popis: uzivatel.email,
        smazano: uzivatel.deletedAt!.toISOString(),
        // Aktivita se počítá taky: kdo se přihlásil a díval se na klienty,
        // po sobě stopu nechal (Nastavení → Aktivita).
        maHistorii: calls > 0 || tasks > 0 || auditLog > 0 || events > 0,
        procNejde: "Po účtu zůstaly záznamy v systému nebo v aktivitě.",
      };
    }),
  ].sort((a, b) => b.smazano.localeCompare(a.smazano));

  return (
    <>
      <div>
        <h2 className="text-2xl font-semibold">Smazané</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Všechno, co kdo odstranil, rozdělené podle druhu záznamu. Vrátit i nadobro smazat smí jen
          administrátor.
        </p>
      </div>

      <p className="text-muted-foreground max-w-prose text-sm">
        Nikde jinde v systému se tyhle záznamy nezobrazují. <strong>Obnovit</strong> je vrátí tam,
        odkud zmizely; <strong>Trvale smazat</strong> je odstraní nenávratně a jen tehdy, když po
        sobě nic nenechaly.
      </p>

      <SeznamSmazanych radky={radky} />
    </>
  );
}
