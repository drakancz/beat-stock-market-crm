import { db } from "@/lib/db";
import { formatDatumCas } from "@/lib/format";
import { upozorniKlienta } from "@/lib/klient/oznameni";
import { posunDne } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";

import { klientiWebinare } from "./pristup";

/**
 * Připomínka webináře (Fáze 5C, Jakub 11. 10. 2026): **den předem
 * a hodinu předem** všem klientům s účtem, kterým se webinář ukazuje
 * (všichni / členové / kupci kurzu — `klientiWebinare()` v `pristup.ts`).
 *
 * Spouští ji plánovač (`POST /api/planovac`) a funguje s jakoukoli
 * frekvencí spouštění:
 *
 * - **den předem** odejde při prvním běhu v den před webinářem (stačí
 *   ranní plánovač). Zmeškaný den se dožene ještě v den webináře, když do
 *   začátku zbývají aspoň 2 hodiny.
 * - **hodinu předem** odejde při běhu, kdy do začátku zbývá nejvýš
 *   75 minut — jen když plánovač běží často (Railway Cron po 15 minutách).
 *
 * Každá jen jednou: webinář se „zabere“ podmíněným zápisem (`reminded…At`)
 * dřív, než se rozešle. Administrátor připomínku u webináře vypíná
 * (`remindersEnabled`); změna začátku obě připomínky vynuluje
 * (`webinare-actions.ts`). Klient si upozornění vypne v Mém profilu.
 * `remindedDayCount` / `remindedHourCount` = komu připomínka opravdu
 * dorazila (oznámením nebo e-mailem).
 */

const MINUTA = 60_000;
/** Okno pro „hodinu předem“ — s rezervou na plánovač po 15 minutách. */
const HODINU_PREDEM_MS = 75 * MINUTA;
/** Den předem se v den webináře dohání jen tehdy, když do začátku zbývá aspoň tolik. */
const DOHNAT_DEN_MS = 2 * 60 * MINUTA;

export interface VysledekWebinaru {
  denPredem: number;
  hodinuPredem: number;
}

/** Pražské datum `RRRR-MM-DD` okamžiku. */
function denVPraze(okamzik: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(okamzik);
}

export async function pripomenWebinare(ted = new Date()): Promise<VysledekWebinaru> {
  const vysledek: VysledekWebinaru = { denPredem: 0, hodinuPredem: 0 };
  const dnes = dnesniZacatek();
  const zitra = denVPraze(posunDne(dnes, 1));
  const dnesText = denVPraze(dnes);

  const webinare = await db.webinar.findMany({
    where: {
      deletedAt: null,
      remindersEnabled: true,
      startsAt: { gt: ted, lt: posunDne(dnes, 2) },
      OR: [{ remindedDayAt: null }, { remindedHourAt: null }],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      joinUrl: true,
      audience: true,
      remindedDayAt: true,
      remindedHourAt: true,
      course: { select: { productId: true, deletedAt: true, publishedAt: true } },
    },
  });

  for (const webinar of webinare) {
    try {
      const doZacatku = webinar.startsAt.getTime() - ted.getTime();
      const den = denVPraze(webinar.startsAt);
      const hodina = !webinar.remindedHourAt && doZacatku <= HODINU_PREDEM_MS;
      const denPredem =
        !hodina &&
        !webinar.remindedDayAt &&
        (den === zitra || (den === dnesText && doZacatku >= DOHNAT_DEN_MS));
      if (!hodina && !denPredem) continue;

      // Zabrat dřív, než se rozešle — souběžný běh ho pak přeskočí.
      // S „hodinu předem“ se zabere i den předem, ať nepřijdou dvě naráz.
      const zabrano = await db.webinar.updateMany({
        where: hodina
          ? { id: webinar.id, remindedHourAt: null }
          : { id: webinar.id, remindedDayAt: null },
        data: hodina
          ? { remindedHourAt: ted, ...(webinar.remindedDayAt ? {} : { remindedDayAt: ted }) }
          : { remindedDayAt: ted },
      });
      if (zabrano.count === 0) continue;

      const komu = klientiWebinare(webinar);
      const klienti = komu ? await db.client.findMany({ where: komu, select: { id: true } }) : [];

      const kdy = formatDatumCas(webinar.startsAt);
      const cas = kdy.split(", ")[1] ?? kdy;
      const nadpis = hodina ? "Webinář začíná za hodinu" : "Připomínka webináře";
      const text = hodina
        ? `${webinar.title} začíná v ${cas}.`
        : `${webinar.title} — ${den === zitra ? "zítra" : "dnes"} v ${cas}.`;

      let odeslano = 0;
      for (const klient of klienti) {
        const doruceni = await upozorniKlienta(klient.id, {
          nadpis,
          text,
          odkaz: "/ucet/webinare",
          znacka: `webinar-${webinar.id}`,
          odstavceEmailu: [
            `Dobrý den, připomínáme webinář „${webinar.title}“ — ${kdy}.`,
            webinar.joinUrl
              ? `Připojit se můžete tady: ${webinar.joinUrl}`
              : "Odkaz na připojení najdete v klientské části v sekci Webináře.",
          ],
        });
        if (doruceni === "OZNAMENI" || doruceni === "EMAIL") odeslano += 1;
      }

      await db.webinar.update({
        where: { id: webinar.id },
        data: hodina ? { remindedHourCount: odeslano } : { remindedDayCount: odeslano },
      });
      if (hodina) vysledek.hodinuPredem += 1;
      else vysledek.denPredem += 1;
    } catch (chyba) {
      // Jeden webinář nesmí zastavit ostatní. Do logu jen druh chyby.
      console.error(
        "Připomínka webináře selhala:",
        chyba instanceof Error ? chyba.name : "neznámá chyba",
      );
    }
  }

  return vysledek;
}
