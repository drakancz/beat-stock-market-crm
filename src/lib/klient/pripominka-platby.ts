import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { nastaveniGoPay } from "@/lib/platby/gopay";
import { cenaPolozkySDph } from "@/lib/dph";
import { formatDatum, formatMoney } from "@/lib/format";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";

import { upozorniKlienta, type Doruceni } from "./oznameni";

/**
 * Připomínka nezaplacené objednávky (Fáze 5A, Jakub 11. 10. 2026).
 *
 * Spouští ji **jen ranní plánovač** (`POST /api/planovac`), ne otevření
 * stránky — zprávy klientům mají chodit ve slušnou hodinu.
 *
 * - Objednávka ve stavu **Nová** nebo **Nezaplaceno**, nesmazaná:
 *   první připomínka `paymentReminderFirstDays` dní po objednávce (výchozí
 *   3), druhá po `paymentReminderSecondDays` (výchozí 7). Počítá se
 *   v pražských dnech: objednávka z 10. 10. dostane první 13. 10. ráno.
 * - Klient dostane oznámení na telefon, jinak e-mail (`upozorniKlienta()`).
 *   **Text oznámení je bez částky** (zamčená obrazovka), e-mail smí říct
 *   produkty i cenu s DPH.
 * - Úkol zavolat s druhou připomínkou zanikl 20. 10. 2026 (Jakub).
 * - **Každá připomínka jen jednou** — podmíněný zápis počtu
 *   (`paymentReminders`), takže dvojí spuštění plánovače nic nezdvojí.
 *   Zmeškaný den se dožene (hledá se „starší než“, ne „přesně“). Kdo je
 *   už za druhou hranicí a první nedostal, dostane rovnou druhou.
 * - Jak připomínka dorazila, je u objednávky (`paymentReminderDelivery`) —
 *   v CRM je vidět i „nedoručeno, klient nemá účet“. Vidí každý přihlášený.
 *
 * Objednávky přijaté před nasazením (11. 10. 2026) migrace označila jako
 * připomenuté — připomínky chodí jen k novým.
 */

export interface VysledekPripominek {
  prvni: number;
  druha: number;
}

/** Odstavce e-mailu: co klient objednal a kolik zaplatí (s DPH). */
function odstavceEmailu(
  objednavka: {
    number: string;
    createdAt: Date;
    currency: string;
    items: (Parameters<typeof cenaPolozkySDph>[0] & { quantity: number })[];
    produkty: { name: string; quantity: number }[];
  },
  druha: boolean,
): string[] {
  const celkem = objednavka.items.reduce(
    (soucet, polozka) => soucet + polozka.quantity * cenaPolozkySDph(polozka),
    0,
  );
  const co = objednavka.produkty
    .map((p) => (p.quantity > 1 ? `${p.name} (${p.quantity}×)` : p.name))
    .join(", ");
  return [
    `Dobrý den, objednávka ${objednavka.number} z ${formatDatum(objednavka.createdAt)} zatím není zaplacená.`,
    `Objednali jste: ${co}. K úhradě: ${formatMoney(celkem, objednavka.currency)} včetně DPH.`,
    // Platební brána (19. 10. 2026): odkaz v e-mailu vede do klientské části.
    ...(nastaveniGoPay()
      ? [
          "Zaplatit můžete online kartou nebo převodem — v klientské části u objednávky klikněte na Zaplatit.",
        ]
      : []),
    druha
      ? "Pokud jste už platili, zprávu prosím ignorujte. Když s platbou potřebujete pomoct, odpovězte nám — rádi se ozveme."
      : "Pokud jste už platili, zprávu prosím ignorujte — platba se někdy spáruje se zpožděním.",
  ];
}

export async function pripomenNezaplacene(): Promise<VysledekPripominek> {
  const vysledek: VysledekPripominek = { prvni: 0, druha: 0 };

  const nastaveni = await db.companySettings.findUnique({
    where: { id: "firma" },
    select: {
      paymentRemindersEnabled: true,
      paymentReminderFirstDays: true,
      paymentReminderSecondDays: true,
    },
  });
  // Bez řádku v Nastavení platí výchozí hodnoty (zapnuto, 3 a 7 dní).
  if (nastaveni && !nastaveni.paymentRemindersEnabled) return vysledek;
  const prvniDnu = nastaveni?.paymentReminderFirstDays ?? 3;
  const druhaDnu = nastaveni?.paymentReminderSecondDays ?? 7;

  const dnes = dnesniZacatek();
  // Objednávka z pražského dne D dostane připomínku v den D + N.
  const hranicePrvni = posunDne(dnes, -prvniDnu + 1);
  const hraniceDruha = posunDne(dnes, -druhaDnu + 1);

  const kandidati = await db.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NOVA", "NEZAPLACENO"] },
      paymentReminders: { lt: 2 },
      createdAt: { lt: hranicePrvni },
      client: { deletedAt: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      clientId: true,
      createdAt: true,
      currency: true,
      paymentReminders: true,
      client: { select: { name: true } },
      items: {
        select: {
          quantity: true,
          netPrice: true,
          vatPercent: true,
          product: { select: { name: true, netPrice: true, vatRate: { select: { rate: true } } } },
        },
      },
    },
  });

  for (const objednavka of kandidati) {
    const druha = objednavka.createdAt < hraniceDruha;
    // Ještě nepřišel čas na další připomínku (první už odešla, na druhou je brzy).
    if (!druha && objednavka.paymentReminders >= 1) continue;
    const novyPocet = druha ? 2 : 1;

    try {
      // Zabrat si připomínku dřív, než odejde — souběžný běh ji nepošle znovu.
      const zabrano = await db.order.updateMany({
        where: {
          id: objednavka.id,
          paymentReminders: objednavka.paymentReminders,
          status: { in: ["NOVA", "NEZAPLACENO"] },
          deletedAt: null,
        },
        data: { paymentReminders: novyPocet, paymentRemindedAt: new Date() },
      });
      if (zabrano.count === 0) continue;

      const doruceni: Doruceni = await upozorniKlienta(objednavka.clientId, {
        nadpis: "Objednávka čeká na zaplacení",
        text: `Objednávka ${objednavka.number} zatím není zaplacená. Podrobnosti najdete v klientské části.`,
        odkaz: "/ucet",
        znacka: `platba-${objednavka.number}`,
        odstavceEmailu: odstavceEmailu(
          {
            ...objednavka,
            produkty: objednavka.items.map((p) => ({ name: p.product.name, quantity: p.quantity })),
          },
          druha,
        ),
      });

      await db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: objednavka.id },
          data: { paymentReminderDelivery: doruceni },
        });
        await zapisDoAuditu(tx, {
          userId: null,
          entity: "orders",
          entityId: objednavka.id,
          action: "objednavka.pripomenuta",
          after: { cislo: objednavka.number, pripominka: novyPocet, doruceni },
        });
      });

      if (druha) vysledek.druha += 1;
      else vysledek.prvni += 1;
    } catch (chyba) {
      // Jedna objednávka nesmí zastavit ostatní. Do logu jen druh chyby.
      console.error(
        "Připomínka platby selhala:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }

  return vysledek;
}
