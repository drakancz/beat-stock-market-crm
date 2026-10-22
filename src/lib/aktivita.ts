import { after } from "next/server";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { UserEventKind } from "@/generated/prisma/enums";
import { POPIS_AUDITU, type AuditniAkce } from "@/lib/audit";
import { db } from "@/lib/db";
import { findNavItem } from "@/lib/navigation";
import { prectiObdobi, type Obdobi } from "@/lib/obdobi";
import { cisloParam, precti, textParam, vyberParam, type Parametry } from "@/lib/parametry";
import type { Role } from "@/generated/prisma/enums";
import { DUVOD_NEUSPECHU, USER_EVENT_LABEL } from "@/lib/types";

/**
 * Aktivita uživatelů — kdy se kdo přihlásil a které obrazovky otevřel.
 *
 * Doplňuje auditní log (`src/lib/audit.ts`): ten říká, co kdo **změnil**
 * a zapisuje se ve stejné transakci jako změna. Tohle je záznam o tom,
 * co kdo **dělal a viděl**, a nesmí nikdy shodit přihlášení ani stránku —
 * když se zápis nepovede, jen se to poznamená do logu serveru.
 *
 * Záznam je **po obrazovkách, ne po kliknutích** (Jakub, 10. 9. 2026).
 * Heslo, kód z telefonu, obsah formulářů ani hledané výrazy sem nepatří
 * (security_warnings.md, pravidla 3 a 8).
 *
 * **Číst ji smí jen administrátor** (Jakub, 10. 9. 2026). Funkce na čtení
 * níž roli samy neověřují — volá je jen obrazovka Nastavení → Aktivita,
 * která má `requireAdmin()` na prvním řádku i v rámu sekce.
 */

/* ---------- Zápis ---------- */

export interface Udalost {
  userId: string;
  kind: UserEventKind;
  /** Adresa obrazovky bez části za otazníkem. */
  path?: string;
  clientId?: string;
  /** Proč přihlášení neprošlo — kód z `DUVOD_NEUSPECHU`, nikdy zadaný text. */
  detail?: string;
}

export async function zapisUdalost(udalost: Udalost) {
  try {
    await db.userEvent.create({ data: udalost });
  } catch (chyba) {
    // Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu.
    console.error(
      "Aktivitu se nepodařilo zapsat:",
      chyba instanceof Error ? chyba.name : "neznámá chyba",
    );
  }
}

/**
 * Zápis až po odeslání odpovědi.
 *
 * U přihlášení je to nutnost, ne pohodlí: neúspěšný pokus se zapisuje jen
 * u existujícího účtu, a kdyby se na zápis čekalo, odpověď by u něj trvala
 * déle a šlo by podle toho poznat, které e-maily v systému jsou.
 */
export function zapisUdalostPozdeji(udalost: Udalost) {
  after(() => zapisUdalost(udalost));
}

/* ---------- Filtry z adresy ---------- */

export type DruhAktivity = "prihlaseni" | "neuspesne" | "obrazovky" | "mcp" | "zmeny";

export const DRUHY_AKTIVITY: { id: DruhAktivity; label: string }[] = [
  { id: "prihlaseni", label: "Přihlášení a odhlášení" },
  { id: "neuspesne", label: "Neúspěšná přihlášení" },
  { id: "obrazovky", label: "Otevřené obrazovky" },
  { id: "mcp", label: "Dotazy přes AI (MCP a asistent)" },
  { id: "zmeny", label: "Změny" },
];

/** Které druhy záznamů z `user_events` patří k danému filtru. */
const DRUHY_UDALOSTI: Record<DruhAktivity, UserEventKind[]> = {
  prihlaseni: ["PRIHLASENI", "ODHLASENI", "NEUSPESNE_PRIHLASENI"],
  neuspesne: ["NEUSPESNE_PRIHLASENI"],
  obrazovky: ["ZOBRAZENI"],
  mcp: ["MCP", "ASISTENT"],
  zmeny: [],
};

export interface FiltrAktivity {
  obdobi: Obdobi;
  uzivatelId?: string;
  druh?: DruhAktivity;
  stranka: number;
}

/**
 * Filtry z adresy. **Co přijde z adresy, je vstup od uživatele**
 * (security_warnings.md, pravidlo 11) — druh jen z uzavřeného seznamu,
 * id a stránka ořezané na rozumný rozsah.
 */
export function prectiFiltrAktivity(parametry: Parametry): FiltrAktivity {
  const vstup = precti(
    z.object({
      uzivatel: textParam(64),
      druh: vyberParam(DRUHY_AKTIVITY.map((polozka) => polozka.id)),
      stranka: cisloParam({ min: 1, max: 1000, vychozi: 1 }),
    }),
    parametry,
  );

  return {
    obdobi: prectiObdobi(parametry),
    uzivatelId: vstup.uzivatel,
    druh: vstup.druh,
    stranka: vstup.stranka,
  };
}

/* ---------- Souhrn po lidech ---------- */

/** Přestávka, po které se další krok počítá jako nové sezení. */
export const PRESTAVKA_MINUT = 30;

export interface SouhrnCloveka {
  id: string;
  name: string;
  role: Role;
  smazany: boolean;
  /** Poslední úspěšné přihlášení vůbec, ne jen v období. */
  posledniPrihlaseni: Date | null;
  /** Kolik souvislých sezení v aplikaci v období proběhlo. */
  sezeni: number;
  /** Odhad času v aplikaci v minutách, viz `odhadCasu()`. */
  minutVAplikaci: number;
  obrazovek: number;
  zmen: number;
  neuspesnych: number;
}

/**
 * Odhad času v aplikaci.
 *
 * Kroky (otevřené obrazovky, přihlášení, změny) se seřadí podle času
 * a přestávka delší než `PRESTAVKA_MINUT` sezení ukončí. Sčítá se doba
 * od prvního do posledního kroku každého sezení. Kolik člověk strávil
 * na poslední obrazovce, se bez sledování kliknutí zjistit nedá — proto
 * je to odhad, spíš nižší než vyšší.
 */
function odhadCasu(casy: number[]): { sezeni: number; minut: number } {
  if (casy.length === 0) return { sezeni: 0, minut: 0 };

  casy.sort((a, b) => a - b);

  let sezeni = 1;
  let celkem = 0;
  let zacatek = casy[0];
  let posledni = casy[0];

  for (const cas of casy.slice(1)) {
    if (cas - posledni > PRESTAVKA_MINUT * 60_000) {
      celkem += posledni - zacatek;
      sezeni += 1;
      zacatek = cas;
    }
    posledni = cas;
  }
  celkem += posledni - zacatek;

  return { sezeni, minut: celkem / 60_000 };
}

export async function nactiSouhrnAktivity(obdobi: Obdobi): Promise<SouhrnCloveka[]> {
  const vObdobi = { gte: obdobi.od, lt: obdobi.do };

  const [lide, udalosti, zmeny, prihlaseni] = await Promise.all([
    db.user.findMany({ select: { id: true, name: true, role: true, deletedAt: true } }),
    db.userEvent.findMany({
      where: { at: vObdobi },
      select: { userId: true, at: true, kind: true },
    }),
    db.auditLogEntry.findMany({
      where: { at: vObdobi, userId: { not: null } },
      select: { userId: true, at: true },
    }),
    db.userEvent.groupBy({
      by: ["userId"],
      where: { kind: "PRIHLASENI" },
      _max: { at: true },
    }),
  ]);

  const radky = new Map<string, SouhrnCloveka>();
  const casy = new Map<string, number[]>();

  for (const clovek of lide) {
    radky.set(clovek.id, {
      id: clovek.id,
      name: clovek.name,
      role: clovek.role,
      smazany: clovek.deletedAt !== null,
      posledniPrihlaseni: null,
      sezeni: 0,
      minutVAplikaci: 0,
      obrazovek: 0,
      zmen: 0,
      neuspesnych: 0,
    });
    casy.set(clovek.id, []);
  }

  for (const udalost of udalosti) {
    const radek = radky.get(udalost.userId);
    if (!radek) continue;

    // Neúspěšný pokus není čas strávený v aplikaci.
    if (udalost.kind === "NEUSPESNE_PRIHLASENI") {
      radek.neuspesnych += 1;
      continue;
    }
    // Dotaz přes AI není čas strávený v aplikaci — AI se ptá sama
    // a rychle za sebou, odhad by vyšel nesmyslně.
    if (udalost.kind === "MCP" || udalost.kind === "ASISTENT") continue;
    if (udalost.kind === "ZOBRAZENI") radek.obrazovek += 1;
    casy.get(udalost.userId)?.push(udalost.at.getTime());
  }

  for (const zmena of zmeny) {
    const radek = zmena.userId ? radky.get(zmena.userId) : undefined;
    if (!radek) continue;
    radek.zmen += 1;
    casy.get(radek.id)?.push(zmena.at.getTime());
  }

  for (const skupina of prihlaseni) {
    const radek = radky.get(skupina.userId);
    if (radek) radek.posledniPrihlaseni = skupina._max.at;
  }

  for (const radek of radky.values()) {
    const odhad = odhadCasu(casy.get(radek.id) ?? []);
    radek.sezeni = odhad.sezeni;
    radek.minutVAplikaci = odhad.minut;
  }

  // Smazaní kolegové jen tehdy, když v období něco dělali — jinak do
  // přehledu týmu nepatří (stejně jako nikde jinde).
  return [...radky.values()]
    .filter((radek) => !radek.smazany || radek.sezeni + radek.zmen + radek.neuspesnych > 0)
    .sort((a, b) => b.minutVAplikaci - a.minutVAplikaci || a.name.localeCompare(b.name, "cs"));
}

/* ---------- Seznam záznamů ---------- */

export type DruhZaznamu = "prihlaseni" | "neuspesne" | "obrazovka" | "mcp" | "zmena";

export interface ZaznamAktivity {
  id: string;
  at: Date;
  kdo: string;
  druh: DruhZaznamu;
  titulek: string;
  popis: string | null;
  /** Kam se dá ze záznamu přejít — jen u toho, co pořád existuje. */
  odkaz: string | null;
}

export const NA_STRANKU = 50;

const KARTA_KLIENTA = /^\/klienti\/[^/]+$/;

/** Popis otevřené obrazovky: název z menu, u karty klienta jeho jméno. */
function popisObrazovky(
  path: string | null,
  klient: { name: string; deletedAt: Date | null } | null,
): Pick<ZaznamAktivity, "titulek" | "popis" | "odkaz"> {
  if (!path) return { titulek: USER_EVENT_LABEL.ZOBRAZENI, popis: null, odkaz: null };

  if (KARTA_KLIENTA.test(path)) {
    if (klient) {
      return {
        titulek: `Karta klienta ${klient.name}`,
        popis: klient.deletedAt ? "klient je dnes smazaný" : null,
        odkaz: klient.deletedAt ? null : path,
      };
    }
    // Vazba se nezapíše u karty, kterou ten člověk vidět nesmí — pokus
    // o ni je pro administrátora užitečná informace.
    return { titulek: "Karta klienta", popis: "cizí, nebo neexistující klient", odkaz: null };
  }

  if (path === "/profil") return { titulek: "Můj účet", popis: null, odkaz: null };

  const polozka = findNavItem(path, "ADMINISTRATOR");
  return {
    titulek: polozka?.label ?? "Jiná obrazovka",
    popis: path === polozka?.href ? null : path,
    odkaz: polozka ? path : null,
  };
}

/**
 * Kdo změnu udělal, když u ní není žádný uživatel.
 *
 * Jsou dvě takové: nastavení hesla z odkazu v e-mailu a klient přijatý
 * z webu přes `POST /api/leady` (Jakub, 12. 9. 2026). Splést je dohromady
 * by mátlo — „bez přihlášení" u leadu z webu vypadá jako chyba.
 *
 * Odeslání do SmartEmailingu bez uživatele je vždy lead z webu (Jakub,
 * 15. 9. 2026) — z formuláře, hromadně i znovu ho spouští člověk.
 * Odebrání souhlasu po odhlášení bez uživatele poslal SmartEmailing webhookem.
 */
function kdoBezPrihlaseni(akce: string): string {
  if (akce === "klient.odhlasen-ze-smartemailingu") return "SmartEmailing (webhook)";
  if (akce.startsWith("klient.ucet-")) return "klient (klientská část)";
  // Certifikát se vydá sám, když klient dokončí kurz (Fáze 5C, 11. 10. 2026).
  if (akce === "certifikat.vydan") return "klient (klientská část)";
  // Dotaz u lekce klient pokládá a stahuje sám (5C, 18. 10. 2026).
  if (akce === "dotaz.polozen" || akce === "dotaz.stazen") return "klient (klientská část)";
  // Konzultaci rezervuje, překládá a ruší klient sám (5B, 19. 10. 2026);
  // administrátor má u zrušení vlastní jméno.
  if (akce.startsWith("konzultace.")) return "klient (klientská část)";
  if (akce === "objednavka.pripomenuta") return "CRM (připomínka platby)";
  // Zaplacení objednávky ověřené u platební brány (19. 10. 2026).
  if (akce === "objednavka.stav-zmenen") return "GoPay (platební brána)";
  // Úkoly bez uživatele zakládá a uklízí CRM samo — hlídání platnosti
  // členství (`platnost.ts`, 24. 9. 2026) a připomínka platby
  // (`pripominka-platby.ts`, 11. 10. 2026).
  if (akce.startsWith("ukol.")) return "CRM (automatický úkol)";
  // Štítek a zpráva bez uživatele = pravidlo „když X, udělej Y“ (5D, 18. 10. 2026).
  if (
    akce === "klient.stitek-pridan" ||
    akce === "klient.stitek-odebran" ||
    akce === "klient.zprava-odeslana"
  ) {
    return "CRM (pravidlo)";
  }
  return akce.includes("z-webu") || akce.startsWith("klient.smartemailing")
    ? "web (rozhraní pro leady)"
    : "bez přihlášení (z odkazu)";
}

/** Čeho se změna týkala — jméno z hodnot uložených v auditním logu. */
function nazevZAuditu(...hodnoty: Prisma.JsonValue[]): string | null {
  for (const hodnota of hodnoty) {
    if (!hodnota || typeof hodnota !== "object" || Array.isArray(hodnota)) continue;
    for (const klic of ["name", "nazev", "klient"]) {
      const text = (hodnota as Record<string, unknown>)[klic];
      if (typeof text === "string") return text;
    }
  }
  return null;
}

/**
 * Záznamy za období od nejnovějšího, po stránkách.
 *
 * Skládá se ze dvou tabulek — aktivity a auditního logu — takže se
 * z každé načte tolik řádků, kolik je potřeba do konce požadované
 * stránky, a seřadí se dohromady. U týmu o pěti lidech je to v pořádku;
 * hloubka stránkování je omezená v `prectiFiltrAktivity()`.
 */
export async function nactiSeznamAktivity(filtr: FiltrAktivity) {
  const vObdobi = { gte: filtr.obdobi.od, lt: filtr.obdobi.do };

  const druhy = filtr.druh
    ? DRUHY_UDALOSTI[filtr.druh]
    : DRUHY_UDALOSTI.prihlaseni.concat("ZOBRAZENI", "MCP", "ASISTENT");
  const vcetneZmen = !filtr.druh || filtr.druh === "zmeny";

  const kdeUdalosti: Prisma.UserEventWhereInput = {
    at: vObdobi,
    kind: { in: druhy },
    ...(filtr.uzivatelId ? { userId: filtr.uzivatelId } : {}),
  };

  // Heslo nastavené z odkazu nemá přihlášeného autora — patří tomu,
  // o jehož účet jde.
  const kdeZmen: Prisma.AuditLogEntryWhereInput = {
    at: vObdobi,
    ...(filtr.uzivatelId
      ? {
          OR: [
            { userId: filtr.uzivatelId },
            { userId: null, entity: "users", entityId: filtr.uzivatelId },
          ],
        }
      : {}),
  };

  const nacist = filtr.stranka * NA_STRANKU;

  const [pocetUdalosti, pocetZmen, udalosti, zmeny] = await Promise.all([
    druhy.length > 0 ? db.userEvent.count({ where: kdeUdalosti }) : 0,
    vcetneZmen ? db.auditLogEntry.count({ where: kdeZmen }) : 0,
    druhy.length > 0
      ? db.userEvent.findMany({
          where: kdeUdalosti,
          orderBy: { at: "desc" },
          take: nacist,
          include: {
            user: { select: { name: true } },
            client: { select: { name: true, deletedAt: true } },
          },
        })
      : [],
    vcetneZmen
      ? db.auditLogEntry.findMany({
          where: kdeZmen,
          orderBy: { at: "desc" },
          take: nacist,
          select: {
            id: true,
            at: true,
            action: true,
            entity: true,
            entityId: true,
            before: true,
            after: true,
            user: { select: { name: true } },
          },
        })
      : [],
  ]);

  const zaznamy: ZaznamAktivity[] = [
    ...udalosti.map((udalost): ZaznamAktivity => {
      const zaklad = { id: udalost.id, at: udalost.at, kdo: udalost.user.name };

      switch (udalost.kind) {
        case "ZOBRAZENI":
          return { ...zaklad, druh: "obrazovka", ...popisObrazovky(udalost.path, udalost.client) };
        case "MCP":
          // V `detail` je název nástroje, nikdy obsah dotazu.
          return {
            ...zaklad,
            druh: "mcp",
            titulek: USER_EVENT_LABEL.MCP,
            popis: [udalost.detail, udalost.client?.name].filter(Boolean).join(" — ") || null,
            odkaz:
              udalost.clientId && udalost.client && !udalost.client.deletedAt
                ? `/klienti/${udalost.clientId}`
                : null,
          };
        case "ASISTENT":
          // V `detail` jsou použité nástroje, nikdy obsah otázky.
          return {
            ...zaklad,
            druh: "mcp",
            titulek: USER_EVENT_LABEL.ASISTENT,
            popis: udalost.detail,
            odkaz: null,
          };
        case "NEUSPESNE_PRIHLASENI":
          return {
            ...zaklad,
            druh: "neuspesne",
            titulek: USER_EVENT_LABEL.NEUSPESNE_PRIHLASENI,
            popis: (udalost.detail && DUVOD_NEUSPECHU[udalost.detail]) || null,
            odkaz: null,
          };
        default:
          return {
            ...zaklad,
            druh: "prihlaseni",
            titulek: USER_EVENT_LABEL[udalost.kind],
            popis: null,
            odkaz: null,
          };
      }
    }),
    ...zmeny.map((zmena): ZaznamAktivity => ({
      id: zmena.id,
      at: zmena.at,
      kdo: zmena.user?.name ?? kdoBezPrihlaseni(zmena.action),
      druh: "zmena",
      titulek: POPIS_AUDITU[zmena.action as AuditniAkce] ?? zmena.action,
      popis: nazevZAuditu(zmena.before, zmena.after),
      odkaz: zmena.entity === "clients" ? `/klienti/${zmena.entityId}` : null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice((filtr.stranka - 1) * NA_STRANKU, filtr.stranka * NA_STRANKU);

  const celkem = pocetUdalosti + pocetZmen;

  return {
    zaznamy,
    celkem,
    stranek: Math.max(1, Math.ceil(celkem / NA_STRANKU)),
  };
}
