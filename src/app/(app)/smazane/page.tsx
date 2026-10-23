import type { Metadata } from "next";

import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { requireAdmin } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { pocet } from "@/lib/mnozne";
import { jeUkazkovyTym } from "@/lib/ukazka";

import { SeznamSmazanych, type RadekKose } from "./seznam-smazanych";

export const metadata: Metadata = { title: "Smazané" };

export const dynamic = "force-dynamic";

/**
 * Společný koš — jen pro administrátora.
 *
 * Sbíhá se sem všechno odložené: klienti, objednávky,
 * produkty, slevové kódy, brokeři i účty.
 * Záznam se nikde jinde nezobrazuje, ale v databázi zůstává i s historií,
 * takže se dá vrátit přesně tam, odkud zmizel.
 *
 * `requireAdmin()` vrací 404, takže pro nepovolaného tahle obrazovka
 * neexistuje — ani když zná adresu.
 */
export default async function SmazanePage() {
  const admin = await requireAdmin();
  // Ukázkový účet e-maily kolegů neuvidí (src/lib/ukazka.ts) — ani odložených.
  const ukazka = jeUkazkovyTym(admin.email);

  const [klienti, objednavky, produkty, brokeri, uzivatele, kody, doporucitele] = await Promise.all(
    [
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
              tasks: true,
              activities: true,
              orders: true,
              zpravy: true,
              // Účast na webinářích (3C) je taky historie.
              ucastNaWebinarich: true,
              // Rezervace konzultací (5B, 19. 10. 2026) taky.
              rezervace: true,
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
      db.product.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          name: true,
          deletedAt: true,
          _count: { select: { orders: true, platnosti: true, kurzy: true } },
        },
      }),
      db.broker.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          name: true,
          deletedAt: true,
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
            select: { tasks: true, auditLog: true, events: true },
          },
        },
      }),
      db.discountCode.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          code: true,
          note: true,
          deletedAt: true,
          _count: { select: { objednavky: true } },
        },
      }),
      db.referrer.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          name: true,
          kind: true,
          deletedAt: true,
          _count: { select: { kody: true, privedeni: true, objednavky: true, odmeny: true } },
        },
      }),
    ],
  );

  const radky: RadekKose[] = [
    ...klienti.map((klient) => {
      const { tasks, activities, orders, zpravy, ucastNaWebinarich, rezervace } = klient._count;
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
          tasks > 0 ||
          activities > 0 ||
          orders > 0 ||
          zpravy > 0 ||
          ucastNaWebinarich > 0 ||
          rezervace > 0,
        procNejde: klient.mergedInto
          ? "Sloučená karta — podle ní se objednávky zapisují ke správnému klientovi."
          : "Má v systému objednávky, úkoly, zprávy, účast na webinářích nebo rezervace konzultací.",
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
    ...produkty.map((produkt) => {
      const { orders, platnosti, kurzy } = produkt._count;
      return {
        druh: "produkt" as const,
        id: produkt.id,
        nazev: produkt.name,
        popis:
          orders > 0
            ? `v ${pocet(orders, "objednávce", "objednávkách", "objednávkách")}`
            : "nikdo ho neobjednal",
        smazano: produkt.deletedAt!.toISOString(),
        // Objednávky a platnost na produkt odkazují — kdyby zmizel,
        // z historie by se ztratilo, co si klient koupil.
        maHistorii: orders > 0 || platnosti > 0 || kurzy > 0,
        procNejde: "Je v objednávkách, platnosti členství nebo má obsah kurzu.",
      };
    }),
    ...kody.map((kod) => ({
      druh: "slevovy-kod" as const,
      id: kod.id,
      nazev: kod.code,
      popis: [
        kod.note,
        kod._count.objednavky > 0
          ? `v ${pocet(kod._count.objednavky, "objednávce", "objednávkách", "objednávkách")}`
          : "nikdo ho nepoužil",
      ]
        .filter(Boolean)
        .join(", "),
      smazano: kod.deletedAt!.toISOString(),
      // Objednávky na kód odkazují — bez něj by nešlo poznat, odkud sleva je.
      maHistorii: kod._count.objednavky > 0,
      procNejde: "Je u objednávek, které s ním klienti zaplatili.",
    })),
    ...doporucitele.map((doporucitel) => {
      const { kody: kodu, privedeni, objednavky: objednavek, odmeny } = doporucitel._count;
      return {
        druh: "doporucitel" as const,
        id: doporucitel.id,
        nazev: doporucitel.name,
        popis: `${doporucitel.kind === "KLIENT" ? "klient" : "partner"}, přivedl ${pocet(privedeni, "klienta", "klienty", "klientů")}`,
        smazano: doporucitel.deletedAt!.toISOString(),
        // Kdo koho přivedl a komu se co vyplatilo, je historie.
        maHistorii: kodu > 0 || privedeni > 0 || objednavek > 0 || odmeny > 0,
        procNejde: "Má slevové kódy, přivedené klienty nebo odměny.",
      };
    }),
    ...brokeri.map((broker) => ({
      druh: "broker" as const,
      id: broker.id,
      nazev: broker.name,
      popis: "Katalog brokerů",
      smazano: broker.deletedAt!.toISOString(),
      // Brokera nic nedrží — objednávky ho nevedou (22. 9. 2026), portfolia
      // s brokery u klientů zmizela 20. 10. 2026.
      maHistorii: false,
      procNejde: "",
    })),
    ...uzivatele.map((uzivatel) => {
      const { tasks, auditLog, events } = uzivatel._count;
      return {
        druh: "uzivatel" as const,
        id: uzivatel.id,
        nazev: uzivatel.name,
        popis: ukazka ? "Účet týmu" : uzivatel.email,
        smazano: uzivatel.deletedAt!.toISOString(),
        // Aktivita se počítá taky: kdo se přihlásil a díval se na klienty,
        // po sobě stopu nechal (Nastavení → Aktivita).
        maHistorii: tasks > 0 || auditLog > 0 || events > 0,
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
