import type { Prisma } from "@/generated/prisma/client";
import { bezEmailovychAdres } from "@/lib/anonymizace";
import { db } from "@/lib/db";

/**
 * Sekce Chyby — co se při volání mimo CRM pokazilo (Jakub, 15. 9. 2026).
 *
 * Sbíhají se sem selhání SmartEmailingu (odeslání klienta, načtení
 * odhlášených), odesílání e-mailů a odmítnuté leady z webu. **Vidí je
 * a spouští jen administrátor** — záložka SmartEmailing → Chyby
 * (`/smartemailing/chyby`, od 15. 9. 2026 večer) a její akce.
 *
 * Pravidla:
 *
 * 1. **Obsah požadavku se neukládá** (security_warnings.md, pravidlo 8).
 *    Jen druh, kód, u koho a popis bez e-mailových adres. Znovu spustit
 *    posílá aktuální údaje z CRM — odmítnutý lead proto zopakovat nejde.
 * 2. **Zápis chyby nesmí shodit to, co selhalo.** Funkce tady nic nevyhazují.
 * 3. **Opakované selhání téže věci nepřidává řádek.** U nevyřešené chyby se
 *    posune čas a přičte pokus, aby se seznam nezahltil. Leady se nespojují.
 * 4. **Když další pokus projde, chyba se vyřeší sama** (`vyresChyby()`).
 */

export type DruhChyby =
  | "smartemailing.klient"
  /// Odhlášení klienta ze seznamu po odebrání souhlasu nebo změně e-mailu.
  | "smartemailing.odhlaseni-klienta"
  | "smartemailing.odhlaseni"
  /// Zpráva webhooku se správným heslem, kterou CRM nezpracovalo.
  | "smartemailing.webhook"
  | "email.pozvanka"
  | "email.obnova-hesla"
  | "email.uvitani"
  | "email.zkusebni"
  /// Klientská část (30. 9. 2026) — pozvánka a zapomenuté heslo klienta.
  | "email.pozvanka-klienta"
  | "email.obnova-klienta"
  /// Náhradní e-mail místo oznámení v telefonu (3A, 4. 10. 2026). Opakovat
  /// nejde — klient upozornění stejně vidí v klientské části.
  | "email.upozorneni-klienta"
  /// Neodešlo samotné upozornění administrátorovi na chyby.
  | "email.upozorneni"
  /// Osobní e-mail z karty klienta (5D, 5. 11. 2026). Neopakuje se odtud —
  /// kolega ho na kartě vidí jako neodeslaný a pošle znovu sám.
  | "email.osobni"
  | "lead.odmitnut"
  /// Objednávka z Landing Page, kterou CRM nepřijalo.
  | "objednavka.odmitnuta"
  /// Odchozí webhook (19. 10. 2026) — zpráva jiné službě nedorazila.
  /// Neopakuje se, mohla by dorazit dvakrát.
  | "webhook.odeslani"
  /// Google Kalendář (20. 10. 2026) — událost konzultace se nezapsala
  /// ani nesmazala. Neopakuje se odtud; Nastavení → Kalendář má „Zapsat
  /// budoucí rezervace“.
  | "kalendar.zapis";

export const POPIS_DRUHU_CHYBY: Record<DruhChyby, string> = {
  "smartemailing.klient": "SmartEmailing — odeslání klienta",
  "smartemailing.odhlaseni-klienta": "SmartEmailing — odhlášení klienta",
  "smartemailing.odhlaseni": "SmartEmailing — načtení odhlášených",
  "smartemailing.webhook": "SmartEmailing — příjem odhlášení",
  "email.pozvanka": "E-mail — pozvánka",
  "email.obnova-hesla": "E-mail — obnova hesla",
  "email.uvitani": "E-mail — uvítání",
  "email.zkusebni": "E-mail — zkušební zpráva",
  "email.pozvanka-klienta": "E-mail — pozvánka klienta",
  "email.obnova-klienta": "E-mail — obnova hesla klienta",
  "email.upozorneni-klienta": "E-mail — upozornění klientovi",
  "email.upozorneni": "E-mail — upozornění na chyby",
  "email.osobni": "E-mail — osobní zpráva z karty klienta",
  "lead.odmitnut": "Lead z webu — odmítnutý",
  "objednavka.odmitnuta": "Objednávka z Landing Page — odmítnutá",
  "webhook.odeslani": "Webhook — nedoručená zpráva",
  "kalendar.zapis": "Google Kalendář — událost se nezapsala",
};

export type SkupinaChyb =
  "smartemailing" | "email" | "lead" | "objednavka" | "webhook" | "kalendar";

export const SKUPINA_CHYB: Record<SkupinaChyb, DruhChyby[]> = {
  smartemailing: [
    "smartemailing.klient",
    "smartemailing.odhlaseni-klienta",
    "smartemailing.odhlaseni",
    "smartemailing.webhook",
  ],
  email: [
    "email.pozvanka",
    "email.obnova-hesla",
    "email.uvitani",
    "email.zkusebni",
    "email.pozvanka-klienta",
    "email.obnova-klienta",
    "email.upozorneni-klienta",
    "email.upozorneni",
    "email.osobni",
  ],
  lead: ["lead.odmitnut"],
  objednavka: ["objednavka.odmitnuta"],
  webhook: ["webhook.odeslani"],
  kalendar: ["kalendar.zapis"],
};

/**
 * Jde chybu zopakovat? Odmítnutý lead, odmítnutá objednávka ani zpráva
 * webhooku ne — jejich obsah se neukládá. Upozornění na chyby taky ne:
 * přijde samo s další chybou.
 */
export function jdeZnovuSpustit(druh: string): boolean {
  const bezOpakovani = [
    "lead.odmitnut",
    "objednavka.odmitnuta",
    "email.upozorneni",
    "email.upozorneni-klienta",
    "email.osobni",
    "smartemailing.webhook",
    "webhook.odeslani",
    "kalendar.zapis",
  ];

  return !bezOpakovani.includes(druh);
}

/** Nejdelší popis, který se u chyby uloží (sloupec má 500 znaků). */
const MAX_DETAIL = 500;

/**
 * Popis chyby bez e-mailových adres a HTML značek. Text odpovědi cizí
 * služby může obsahovat adresu klienta — do chybových hlášení osobní
 * údaje nepatří (pravidlo 8).
 */
export function bezEmailu(text: string): string {
  return bezEmailovychAdres(text.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DETAIL);
}

/** Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu. */
function zaloguj(co: string, chyba: unknown) {
  console.error(`Chyby: ${co} selhal:`, chyba instanceof Error ? chyba.name : "neznámá chyba");
}

export interface NovaChyba {
  druh: DruhChyby;
  /** Kód chyby: `POPIS_CHYBY_SMARTEMAILINGU`, u e-mailu `selhalo` / `nenastaveno`, u leadu stav odpovědi. */
  kod: string;
  /** Co přesně se stalo. E-mailové adresy se před uložením vyhodí. */
  detail?: string | null;
  /** Klient, kterého se chyba týká (SmartEmailing). */
  clientId?: string | null;
  /** Uživatel CRM, kterého se chyba týká (e-mail). */
  userId?: string | null;
  /** Kdo akci spustil. Prázdné u leadu z webu a u zapomenutého hesla. */
  spustilId?: string | null;
}

/**
 * Zapíše selhání do sekce Chyby. Když pro stejnou věc (druh + klient
 * a uživatel) už visí nevyřešená chyba, jen se u ní posune čas, kód
 * a počet pokusů.
 */
export async function zapisChybu(chyba: NovaChyba): Promise<void> {
  try {
    const ted = new Date();
    const detail = chyba.detail ? bezEmailu(chyba.detail) : null;
    const clientId = chyba.clientId ?? null;
    const userId = chyba.userId ?? null;
    const spustilId = chyba.spustilId ?? null;

    // Odmítnuté leady a objednávky se neslučují: každý pokus je jiný
    // požadavek z internetu a jejich obsah se neukládá.
    if (chyba.druh !== "lead.odmitnut" && chyba.druh !== "objednavka.odmitnuta") {
      const otevrena = await db.integrationError.findFirst({
        where: { kind: chyba.druh, clientId, userId, resolvedAt: null },
        select: { id: true },
      });

      if (otevrena) {
        await db.integrationError.update({
          where: { id: otevrena.id },
          data: {
            lastAt: ted,
            attempts: { increment: 1 },
            code: chyba.kod,
            detail,
            triggeredById: spustilId,
          },
        });
        return;
      }
    }

    await db.integrationError.create({
      data: {
        kind: chyba.druh,
        code: chyba.kod,
        detail,
        clientId,
        userId,
        triggeredById: spustilId,
        createdAt: ted,
        lastAt: ted,
      },
    });

    // Nová chyba — upozornit administrátory e-mailem (Jakub, 15. 9. 2026).
    // Chyby e-mailů ne: když nefunguje pošta, upozornění by nedorazilo
    // a jeho vlastní selhání by se zacyklilo. Modul se načítá až tady,
    // protože upozornění posílá e-mail a e-mail zapisuje chyby.
    if (!chyba.druh.startsWith("email.")) {
      void import("@/lib/upozorneni-chyb")
        .then((modul) => modul.upozornitNaNovouChybu())
        .catch((vyjimka: unknown) => zaloguj("upozornění na chybu", vyjimka));
    }
  } catch (vyjimka) {
    zaloguj("zápis chyby", vyjimka);
  }
}

export interface Vyreseni {
  /** `vyreseno` — další pokus prošel; `uzavreno` — bez opakování. */
  zpusob: "vyreseno" | "uzavreno";
  /** Kdo chybu vyřešil. Prázdné, když další pokus spustil web. */
  kdoId: string | null;
}

/** Vyřeší nevyřešené chyby daného druhu u klienta nebo uživatele. */
export async function vyresChyby(
  kde: { druh: DruhChyby; clientId?: string; userId?: string },
  jak: Vyreseni,
): Promise<void> {
  try {
    await db.integrationError.updateMany({
      where: {
        kind: kde.druh,
        resolvedAt: null,
        ...(kde.clientId ? { clientId: kde.clientId } : {}),
        ...(kde.userId ? { userId: kde.userId } : {}),
      },
      data: { resolvedAt: new Date(), resolvedById: jak.kdoId, resolution: jak.zpusob },
    });
  } catch (vyjimka) {
    zaloguj("vyřešení chyb", vyjimka);
  }
}

/** Vyřeší jednu konkrétní chybu — po úspěšném Znovu spustit. */
export async function vyresChybu(id: string, jak: Vyreseni): Promise<void> {
  try {
    await db.integrationError.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: jak.kdoId, resolution: jak.zpusob },
    });
  } catch (vyjimka) {
    zaloguj("vyřešení chyby", vyjimka);
  }
}

export type StavChyb = "otevrene" | "vyresene" | "vse";

/**
 * Chyby pro obrazovku Chyby, nejnovější první.
 *
 * **Roli neověřuje** — volá ji jen `/smartemailing/chyby`, která má `requireAdmin()`
 * na prvním řádku i v rámu sekce.
 */
export async function nactiChyby({
  stav,
  skupina,
}: {
  stav: StavChyb;
  skupina: SkupinaChyb | "vse";
}) {
  const kde: Prisma.IntegrationErrorWhereInput = {
    ...(stav === "otevrene" ? { resolvedAt: null } : {}),
    ...(stav === "vyresene" ? { resolvedAt: { not: null } } : {}),
    ...(skupina === "vse" ? {} : { kind: { in: SKUPINA_CHYB[skupina] } }),
  };

  const [pocet, nevyresenych, chyby] = await Promise.all([
    db.integrationError.count({ where: kde }),
    db.integrationError.count({ where: { resolvedAt: null } }),
    db.integrationError.findMany({
      where: kde,
      orderBy: { lastAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        code: true,
        detail: true,
        createdAt: true,
        lastAt: true,
        attempts: true,
        resolvedAt: true,
        resolution: true,
        client: { select: { id: true, name: true, deletedAt: true } },
        user: { select: { id: true, name: true, deletedAt: true } },
        triggeredBy: { select: { name: true } },
        resolvedBy: { select: { name: true } },
      },
    }),
  ]);

  return { pocet, nevyresenych, chyby };
}

/** Kolik nevyřešených chyb je v dané skupině — pro odkaz ze SmartEmailingu. */
export function pocetNevyresenychChyb(skupina: SkupinaChyb): Promise<number> {
  return db.integrationError.count({
    where: { resolvedAt: null, kind: { in: SKUPINA_CHYB[skupina] } },
  });
}
