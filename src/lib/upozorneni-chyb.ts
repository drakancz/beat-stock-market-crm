import { POPIS_DRUHU_CHYBY, type DruhChyby } from "@/lib/chyby";
import { db } from "@/lib/db";
import { posliUpozorneniNaChyby } from "@/lib/email";
import type { PolozkaUpozorneni } from "@/lib/email-sablony";
import { formatDatumCas } from "@/lib/format";
import { osloveniUzivatele } from "@/lib/osloveni";
import { POPIS_CHYBY_SMARTEMAILINGU, type ChybaSmartemailingu } from "@/lib/smartemailing";

/**
 * Upozornění administrátorům na nové chyby e-mailem (Jakub, 15. 9. 2026).
 *
 * Pravidla, která Jakub vybral:
 *
 * 1. **Všem aktivním administrátorům**, nikomu jinému.
 * 2. **Hned, ale nejvýš jednou za 15 minut.** První nová chyba pošle
 *    e-mail hned; chyby v dalších 15 minutách se sečtou do jednoho
 *    dalšího e-mailu na konci lhůty. Hromadné odeslání se stovkou chyb
 *    tak schránku nezaplaví.
 * 3. **Bez osobních údajů** (security_warnings.md, pravidlo 8) — druh,
 *    počet a krátký důvod. Koho se chyba týká, je v sekci Chyby.
 * 4. **Vypínač v Nastavení → Upozornění**, výchozí zapnuto.
 *
 * Chyby e-mailů upozornění nespouštějí a do souhrnu nepatří: když
 * nefunguje pošta, upozornění by nedorazilo a jeho vlastní selhání by se
 * zacyklilo.
 *
 * **Naplánované upozornění žije jen v paměti běžící aplikace.** Když se
 * aplikace během lhůty restartuje, ztratí se — chyby ale nezmizí, přijdou
 * s dalším upozorněním. Pořádná plánovaná úloha přijde s nasazením.
 *
 * Nic tu nevyhazuje: upozornění nesmí shodit to, co selhalo.
 */

/** Nejkratší rozestup mezi dvěma upozorněními. */
export const ROZESTUP_UPOZORNENI_MS = 15 * 60 * 1000;

/** Chyby e-mailů do upozornění nepatří (viz výše). */
const JEN_NE_EMAILY = { NOT: { kind: { startsWith: "email." } } };

interface StavUpozorneni {
  casovac: ReturnType<typeof setTimeout> | null;
}

/** Naplánované odeslání. Na `globalThis`, aby ho nevynulovalo překreslení modulu ve vývoji. */
function stav(): StavUpozorneni {
  const globalni = globalThis as typeof globalThis & { __upozorneniNaChyby?: StavUpozorneni };
  globalni.__upozorneniNaChyby ??= { casovac: null };
  return globalni.__upozorneniNaChyby;
}

/** Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu. */
function zaloguj(co: string, chyba: unknown) {
  console.error(
    `Upozornění na chyby: ${co} selhalo:`,
    chyba instanceof Error ? chyba.name : "neznámá chyba",
  );
}

async function nactiStav() {
  const vyber = { errorNotificationsEnabled: true, errorNotificationSentAt: true } as const;
  const radek = await db.companySettings.findUnique({ where: { id: "firma" }, select: vyber });
  return radek ?? db.companySettings.create({ data: { id: "firma" }, select: vyber });
}

/** Krátký důvod do e-mailu. Jen pevné texty systému, nic z odpovědi cizí služby. */
function duvodChyby(druh: string, kod: string, detail: string | null): string {
  // Webhook: v popisu je důvod odmítnutí ze systému, ne obsah zprávy.
  if (druh === "smartemailing.webhook") return detail ?? `odmítnuto (${kod})`;
  if (druh.startsWith("smartemailing.")) {
    return POPIS_CHYBY_SMARTEMAILINGU[kod as ChybaSmartemailingu] ?? "neznámá chyba";
  }
  // U odmítnutého leadu je v popisu důvod odmítnutí z `leady.ts`, ne obsah požadavku.
  if (druh === "lead.odmitnut") return detail ?? `odmítnuto (${kod})`;
  return kod;
}

function seskup(
  chyby: { kind: string; code: string; detail: string | null }[],
): PolozkaUpozorneni[] {
  const podleDruhu = new Map<string, PolozkaUpozorneni>();

  for (const chyba of chyby) {
    const duvod = duvodChyby(chyba.kind, chyba.code, chyba.detail);
    const polozka = podleDruhu.get(chyba.kind);
    if (polozka) {
      polozka.pocet += 1;
      polozka.duvod = duvod;
    } else {
      podleDruhu.set(chyba.kind, {
        druh: POPIS_DRUHU_CHYBY[chyba.kind as DruhChyby] ?? chyba.kind,
        pocet: 1,
        duvod,
      });
    }
  }

  return [...podleDruhu.values()];
}

/** Pošle souhrn chyb, které přibyly od posledního upozornění. */
async function odesliSouhrn(): Promise<void> {
  try {
    const nastaveni = await nactiStav();
    if (!nastaveni.errorNotificationsEnabled) return;

    const ted = new Date();
    const posledni = nastaveni.errorNotificationSentAt;
    if (posledni && ted.getTime() - posledni.getTime() < ROZESTUP_UPOZORNENI_MS) return;

    const od = posledni ?? new Date(ted.getTime() - ROZESTUP_UPOZORNENI_MS);
    const chyby = await db.integrationError.findMany({
      where: { createdAt: { gt: od }, ...JEN_NE_EMAILY },
      orderBy: { createdAt: "asc" },
      select: { kind: true, code: true, detail: true, createdAt: true },
    });
    if (chyby.length === 0) return;

    // Zabrat odeslání: projde jen tomu, kdo najde čas posledního upozornění
    // nezměněný. Při chybách těsně po sobě tak odejde jediný e-mail.
    const { count } = await db.companySettings.updateMany({
      where: { id: "firma", errorNotificationSentAt: posledni },
      data: { errorNotificationSentAt: ted },
    });
    if (count === 0) return;

    const [nevyresenych, administratori] = await Promise.all([
      db.integrationError.count({ where: { resolvedAt: null } }),
      db.user.findMany({
        where: { role: "ADMINISTRATOR", active: true, deletedAt: null },
        select: { id: true, name: true, email: true, firstName: true, vocative: true },
      }),
    ]);

    const polozky = seskup(chyby);
    const odKdy = formatDatumCas(chyby[0]!.createdAt);

    for (const administrator of administratori) {
      await posliUpozorneniNaChyby({
        komu: administrator.email,
        osloveni: osloveniUzivatele(administrator),
        polozky,
        celkem: chyby.length,
        nevyresenych,
        od: odKdy,
        userId: administrator.id,
        spustilId: null,
      });
    }
  } catch (vyjimka) {
    zaloguj("odeslání", vyjimka);
  }
}

/**
 * Přibyla nová chyba. Upozornění odejde hned, když od posledního uplynulo
 * 15 minut; jinak se naplánuje na konec lhůty (jedno, i pro víc chyb).
 */
export async function upozornitNaNovouChybu(): Promise<void> {
  try {
    const nastaveni = await nactiStav();
    if (!nastaveni.errorNotificationsEnabled) return;

    const zbyva = nastaveni.errorNotificationSentAt
      ? nastaveni.errorNotificationSentAt.getTime() + ROZESTUP_UPOZORNENI_MS - Date.now()
      : 0;

    if (zbyva <= 0) {
      await odesliSouhrn();
      return;
    }

    const naplanovano = stav();
    if (!naplanovano.casovac) {
      // Vteřina navíc, ať lhůta při odeslání opravdu uplynula.
      naplanovano.casovac = setTimeout(() => {
        naplanovano.casovac = null;
        void odesliSouhrn();
      }, zbyva + 1000);
    }
  } catch (vyjimka) {
    zaloguj("naplánování", vyjimka);
  }
}
