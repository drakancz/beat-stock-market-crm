import { after } from "next/server";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { nactiNastaveni } from "@/lib/nastaveni";
import {
  nactiOdhlaseneEmaily,
  odesliVHromadnemOdeslani,
  type ChybaSmartemailingu,
} from "@/lib/smartemailing";
import { vyresChyby, zapisChybu } from "@/lib/chyby";

/**
 * SmartEmailing → Synchronizace kontaktů (Jakub, 13. 9. 2026).
 *
 * **Vidí i používá jen administrátor.** Funkce tady roli samy neověřují —
 * volá je jen obrazovka a serverové akce sekce SmartEmailing, které mají
 * `requireAdmin()` na prvním řádku (a rám sekce taky).
 *
 * Tři věci:
 *
 * 1. **Přehled** — kolik klientů odešlo, čeká a skončilo chybou, seznam
 *    odeslaných.
 * 2. **Hromadné odeslání** klientů se souhlasem a e-mailem, kteří ještě
 *    neodešli — včetně leadů z webu (Jakub, 15. 9. 2026; do té doby se
 *    leady vynechávaly).
 * 3. **Odhlášení** — tlačítko se SmartEmailingu zeptá, kdo se z vybraného
 *    seznamu odhlásil, a těm klientům odebere souhlas s marketingem.
 *    Automaticky to samé dělá webhook (`zpracujOdhlaseniZWebhooku()`,
 *    Jakub 15. 9. 2026) — funguje jen na veřejné adrese s https.
 */

/* ---------- Kdo čeká na odeslání ---------- */

async function kdeCekajiciNaOdeslani(): Promise<Prisma.ClientWhereInput> {
  return {
    // E-mail má každý klient — hlídá to databáze (Jakub, 15. 9. 2026).
    deletedAt: null,
    consentMarketingAt: { not: null },
    smartemailingSentAt: null,
    // Klienti s chybou mají vlastní seznam a tlačítko Odeslat znovu.
    smartemailingError: null,
  };
}

/* ---------- Stav hromadného odeslání ---------- */

interface StavHromadneho {
  bezi: boolean;
  zbyva: number;
}

/**
 * Stav běžícího hromadného odeslání. Drží se v paměti serveru — aplikace
 * běží v jednom procesu, a kdyby se restartovala, nedoběhlí klienti prostě
 * zůstanou mezi čekajícími. Na `globalThis`, aby ho nevynulovalo
 * překreslení modulu ve vývoji.
 */
function stavHromadneho(): StavHromadneho {
  const globalni = globalThis as typeof globalThis & { __smartemailingHromadne?: StavHromadneho };
  globalni.__smartemailingHromadne ??= { bezi: false, zbyva: 0 };
  return globalni.__smartemailingHromadne;
}

/* ---------- Přehled ---------- */

export async function nactiPrehledSynchronizace() {
  const kdeCekajici = await kdeCekajiciNaOdeslani();

  const [odeslano, cekajici, chyby, nahled] = await Promise.all([
    db.client.count({ where: { deletedAt: null, smartemailingSentAt: { not: null } } }),
    db.client.count({ where: kdeCekajici }),
    db.client.count({ where: { deletedAt: null, smartemailingError: { not: null } } }),
    db.client.findMany({
      where: kdeCekajici,
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { name: true },
    }),
  ]);

  const stav = stavHromadneho();

  return {
    odeslano,
    cekajici,
    chyby,
    /** Prvních pár jmen do potvrzovacího okna. */
    nahledCekajicich: nahled.map((klient) => klient.name),
    hromadneBezi: stav.bezi,
    hromadneZbyva: stav.zbyva,
  };
}

export async function nactiOdeslane({
  hledat,
  strana,
  naStranku,
}: {
  hledat: string;
  strana: number;
  naStranku: number;
}) {
  const kde: Prisma.ClientWhereInput = {
    deletedAt: null,
    smartemailingSentAt: { not: null },
    ...(hledat
      ? {
          OR: [
            { name: { contains: hledat, mode: "insensitive" } },
            { email: { contains: hledat, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [pocet, klienti] = await Promise.all([
    db.client.count({ where: kde }),
    db.client.findMany({
      where: kde,
      orderBy: { smartemailingSentAt: "desc" },
      skip: (strana - 1) * naStranku,
      take: naStranku,
      select: {
        id: true,
        name: true,
        email: true,
        smartemailingSentAt: true,
        smartemailingListName: true,
        consentMarketingAt: true,
      },
    }),
  ]);

  return {
    pocet,
    klienti: klienti.map((klient) => ({
      clientId: klient.id,
      name: klient.name,
      email: klient.email,
      at: klient.smartemailingSentAt,
      seznam: klient.smartemailingListName,
      souhlas: klient.consentMarketingAt !== null,
    })),
  };
}

/* ---------- Hromadné odeslání ---------- */

/** Pauza mezi klienty — SmartEmailing pustí 4 volání za sekundu na účet. */
const PAUZA_MS = 400;
/** Když SmartEmailing hlásí překročený limit, chvíli se počká. */
const PAUZA_PO_LIMITU_MS = 5_000;

const pockej = (ms: number) => new Promise((hotovo) => setTimeout(hotovo, ms));

export type VysledekHromadneho =
  { stav: "spusteno"; pocet: number } | { stav: "bezi" } | { stav: "vypnuto" } | { stav: "nic" };

/**
 * Spustí hromadné odeslání na pozadí a hned vrátí, kolik klientů půjde.
 *
 * Běží po odpovědi (`after()`), klient po klientovi. Výsledek každého se
 * zapíše k němu i do auditu stejně jako při běžném odeslání (s
 * `hromadne: true`). Když SmartEmailing odmítne přihlašovací údaje, zbytek
 * se nezkouší — zůstane mezi čekajícími.
 */
export async function spustHromadneOdeslani(userId: string): Promise<VysledekHromadneho> {
  const stav = stavHromadneho();
  if (stav.bezi) return { stav: "bezi" };

  const nastaveni = await nactiNastaveni();
  if (!nastaveni.smartemailingEnabled || nastaveni.smartemailingListId === null) {
    return { stav: "vypnuto" };
  }

  const klienti = await db.client.findMany({
    where: await kdeCekajiciNaOdeslani(),
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (klienti.length === 0) return { stav: "nic" };

  stav.bezi = true;
  stav.zbyva = klienti.length;

  after(async () => {
    try {
      for (const { id } of klienti) {
        try {
          const vysledek = await odesliVHromadnemOdeslani(id, userId);
          if (vysledek.stav === "vypnuto") break;
          if (
            vysledek.stav === "chyba" &&
            // Bez platných údajů nebo licence by selhal i každý další klient.
            (vysledek.chyba === "prihlaseni" ||
              vysledek.chyba === "nenastaveno" ||
              vysledek.chyba === "licence")
          ) {
            break;
          }
          if (vysledek.stav === "chyba" && vysledek.chyba === "limit") {
            await pockej(PAUZA_PO_LIMITU_MS);
          }
        } catch (chyba) {
          console.error(
            "SmartEmailing: hromadné odeslání klienta selhalo:",
            chyba instanceof Error ? chyba.name : "neznámá chyba",
          );
        }

        stav.zbyva -= 1;
        await pockej(PAUZA_MS);
      }
    } finally {
      stav.bezi = false;
      stav.zbyva = 0;
    }
  });

  return { stav: "spusteno", pocet: klienti.length };
}

/* ---------- Odhlášení ---------- */

export type VysledekOdhlaseni =
  | {
      ok: true;
      odebrano: number;
      odhlasenychVeSmartemailingu: number;
      /** Klientů v CRM, jejichž e-mail SmartEmailing hlásí jako nedoručitelný. */
      nedorucitelnych: number;
      /** Kontaktů přeskočených, protože se ve SmartEmailingu změnily před chvílí. */
      odlozenych: number;
    }
  | { ok: false; chyba: ChybaSmartemailingu | "bez-seznamu" };

/** Kolik adres se posílá do jednoho dotazu `in` — PostgreSQL má strop parametrů. */
const DAVKA_ADRES = 1_000;

function poDavkach<T>(polozky: T[]): T[][] {
  const davky: T[][] = [];
  for (let i = 0; i < polozky.length; i += DAVKA_ADRES) {
    davky.push(polozky.slice(i, i + DAVKA_ADRES));
  }
  return davky;
}

/**
 * Odebere klientovi souhlas s marketingem, protože se ve SmartEmailingu
 * odhlásil, a zapíše datum odhlášení z odběru (kolonka na kartě klienta).
 * Změna jde do auditu ve stejné transakci. Vrací, jestli se něco změnilo.
 *
 * Klient bez souhlasu se nemění — typicky ten, koho ze seznamu odhlásilo
 * samo CRM po odebrání souhlasu; ten se neodhlásil sám.
 */
async function odeberSouhlasPoOdhlaseni(
  clientId: string,
  {
    userId,
    seznam,
    kdy,
    webhook = false,
  }: { userId: string | null; seznam: string; kdy: Date; webhook?: boolean },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // Podmínka na souhlas i v zápisu — kdyby ho mezitím někdo odebral
    // ručně, druhý záznam v auditu by jen mátl.
    const { count } = await tx.client.updateMany({
      where: { id: clientId, consentMarketingAt: { not: null } },
      data: { consentMarketingAt: null, smartemailingOptedOutAt: kdy },
    });
    if (count === 0) return false;

    await zapisDoAuditu(tx, {
      userId,
      entity: "clients",
      entityId: clientId,
      action: "klient.odhlasen-ze-smartemailingu",
      before: { souhlasMarketing: true },
      after: { souhlasMarketing: false, seznam, ...(webhook ? { webhook: true } : {}) },
    });
    return true;
  });
}

/**
 * Projde odhlášené a nedoručitelné kontakty z vybraného seznamu.
 *
 * - **Odhlášeným** (sami se odhlásili, nebo je SmartEmailing zablokoval)
 *   se odebere souhlas s marketingem. **Týká se i smazaných klientů** —
 *   odvolaný souhlas platí bez ohledu na koš; kdyby klienta někdo obnovil,
 *   nesmí mít souhlas zpátky. Každé odebrání jde do auditu pod
 *   administrátora, který načtení spustil.
 * - **Nedoručitelným** (zpráva se vrátila, adresa neexistuje) se souhlas
 *   **neodebírá** — neodvolali ho, jen mají špatný e-mail (Jakub,
 *   13. 9. 2026). Dostanou značku `smartemailingBouncedAt` a objeví se
 *   v seznamu Špatný e-mail. Značka není změna údajů klienta, do auditu
 *   proto nejde.
 */
export async function odeberSouhlasOdhlasenym(userId: string): Promise<VysledekOdhlaseni> {
  const nastaveni = await nactiNastaveni();
  const seznam = nastaveni.smartemailingListId;
  if (seznam === null) return { ok: false, chyba: "bez-seznamu" };

  const kontakty = await nactiOdhlaseneEmaily(seznam);
  // Selhání jde do sekce Chyby, úspěch vyřeší dřívější (Jakub, 15. 9. 2026).
  if (!kontakty.ok) {
    await zapisChybu({
      druh: "smartemailing.odhlaseni",
      kod: kontakty.chyba,
      detail: kontakty.detail,
      spustilId: userId,
    });
    return { ok: false, chyba: kontakty.chyba };
  }
  await vyresChyby({ druh: "smartemailing.odhlaseni" }, { zpusob: "vyreseno", kdoId: userId });
  const { odhlasene, nedorucitelne } = kontakty.data;

  let nedorucitelnych = 0;
  const ted = new Date();

  for (const davka of poDavkach(nedorucitelne)) {
    // Značka se nepřepisuje — datum říká, kdy se na špatnou adresu přišlo poprvé.
    await db.client.updateMany({
      where: { email: { in: davka }, smartemailingBouncedAt: null },
      data: { smartemailingBouncedAt: ted },
    });
    nedorucitelnych += await db.client.count({ where: { email: { in: davka }, deletedAt: null } });
  }

  let odebrano = 0;

  for (const davka of poDavkach(odhlasene)) {
    const klienti = await db.client.findMany({
      where: {
        email: { in: davka },
        consentMarketingAt: { not: null },
      },
      select: { id: true },
    });

    for (const klient of klienti) {
      const zmeneno = await odeberSouhlasPoOdhlaseni(klient.id, {
        userId,
        seznam: nastaveni.smartemailingListName ?? String(seznam),
        kdy: ted,
      });
      if (zmeneno) odebrano += 1;
    }
  }

  return {
    ok: true,
    odebrano,
    odhlasenychVeSmartemailingu: odhlasene.length,
    nedorucitelnych,
    odlozenych: kontakty.data.odlozene,
  };
}

/* ---------- Odhlášení webhookem ---------- */

/**
 * Jeden kontakt ze zprávy `unsubscribed_contact`. SmartEmailing posílá
 * kontakt se všemi údaji; čte se jen to, co CRM potřebuje — zbytek se
 * zahodí a nikam neukládá (pravidlo 8).
 */
const kontaktZWebhookuSchema = z.object({
  event: z.string().nullish(),
  emailaddress: z.string().trim().min(3).max(320),
  unsubscribed_contactlist_ids: z.array(z.coerce.number()).nullish(),
  // SmartEmailing posílá 0 / 1; pro jistotu se bere i true / false.
  hardbounced: z.union([z.number(), z.boolean()]).nullish(),
  metrics: z
    .object({ email: z.object({ is_hardbounced: z.boolean().nullish() }).nullish() })
    .nullish(),
  contactlists: z
    .array(z.object({ contactlist_id: z.coerce.number(), status: z.string().nullish() }))
    .nullish(),
});

/** Víc kontaktů v jedné zprávě SmartEmailing neposílá; delší zpráva je podezřelá. */
const MAX_KONTAKTU_VE_ZPRAVE = 1_000;

export type VysledekWebhooku =
  | {
      ok: true;
      /** Klientů, kterým se odebral souhlas. */
      odebrano: number;
      /** Klientů, jejichž e-mail SmartEmailing hlásí jako nedoručitelný. */
      nedorucitelnych: number;
      /** Kontaktů z jiného seznamu, jiné události, nebo které v CRM nemáme. */
      preskoceno: number;
    }
  | { ok: false; chyba: string };

/**
 * Zpráva webhooku `unsubscribed_contact` — klient se ve SmartEmailingu
 * odhlásil (Jakub, 15. 9. 2026). Volá ji jen `POST /api/smartemailing/odhlaseni`
 * po ověření hesla.
 *
 * Pravidla stejná jako u tlačítka Načíst odhlášené:
 *
 * - **Počítá se jen odhlášení z našeho seznamu** (vybraného v Nastavení
 *   propojení). Odhlášení z jiných seznamů CRM nezajímá.
 * - **Odhlášenému se odebere souhlas** a zapíše datum — i smazanému
 *   klientovi, odvolaný souhlas platí bez ohledu na koš. Do auditu bez
 *   uživatele, s `webhook: true`.
 * - **Nedoručitelnému se souhlas neodebírá** (Jakub, 13. 9. 2026), jen
 *   dostane značku Špatný e-mail.
 *
 * Tělo je pole kontaktů (tak ho SmartEmailing posílá u kontaktů), přijme
 * se ale i jeden objekt.
 */
export async function zpracujOdhlaseniZWebhooku(telo: unknown): Promise<VysledekWebhooku> {
  const polozky = Array.isArray(telo) ? telo : [telo];
  if (polozky.length > MAX_KONTAKTU_VE_ZPRAVE) {
    return { ok: false, chyba: "Zpráva obsahuje příliš mnoho kontaktů." };
  }

  const kontakty = z.array(kontaktZWebhookuSchema).safeParse(polozky);
  if (!kontakty.success) {
    return { ok: false, chyba: "Zpráva nemá podobu odhlášení ze SmartEmailingu." };
  }

  const nastaveni = await nactiNastaveni();
  const seznam = nastaveni.smartemailingListId;
  if (seznam === null) {
    return {
      ok: false,
      chyba: "V Nastavení propojení není vybraný seznam, odhlášení nejde přiřadit.",
    };
  }
  const nazevSeznamu = nastaveni.smartemailingListName ?? String(seznam);

  const ted = new Date();
  let odebrano = 0;
  let nedorucitelnych = 0;
  let preskoceno = 0;

  for (const kontakt of kontakty.data) {
    // Seznamy, ze kterých se právě odhlásil. Kdyby pole chybělo, rozhodne
    // stav u našeho seznamu.
    const zNasehoSeznamu = kontakt.unsubscribed_contactlist_ids
      ? kontakt.unsubscribed_contactlist_ids.includes(seznam)
      : (kontakt.contactlists ?? []).some(
          (clenstvi) => clenstvi.contactlist_id === seznam && clenstvi.status === "unsubscribed",
        );

    if ((kontakt.event && kontakt.event !== "unsubscribed_contact") || !zNasehoSeznamu) {
      preskoceno += 1;
      continue;
    }

    const klienti = await db.client.findMany({
      where: { email: { equals: kontakt.emailaddress, mode: "insensitive" } },
      select: { id: true },
    });
    if (klienti.length === 0) {
      preskoceno += 1;
      continue;
    }

    const nedorucitelny =
      kontakt.hardbounced === 1 ||
      kontakt.hardbounced === true ||
      kontakt.metrics?.email?.is_hardbounced === true;

    if (nedorucitelny) {
      // Značka se nepřepisuje — datum říká, kdy se na špatnou adresu přišlo poprvé.
      await db.client.updateMany({
        where: { id: { in: klienti.map((klient) => klient.id) }, smartemailingBouncedAt: null },
        data: { smartemailingBouncedAt: ted },
      });
      nedorucitelnych += klienti.length;
      continue;
    }

    for (const klient of klienti) {
      const zmeneno = await odeberSouhlasPoOdhlaseni(klient.id, {
        userId: null,
        seznam: nazevSeznamu,
        kdy: ted,
        webhook: true,
      });
      if (zmeneno) odebrano += 1;
    }
  }

  return { ok: true, odebrano, nedorucitelnych, preskoceno };
}

/** Kdo odebrání souhlasu spustil — administrátor tlačítkem, nebo webhook. */
export const KDO_WEBHOOK = "SmartEmailing (webhook)";

/** Posledních 20 klientů, kterým se souhlas odebral po odhlášení. */
export async function nactiPosledniOdhlasene() {
  const zaznamy = await db.auditLogEntry.findMany({
    where: { action: "klient.odhlasen-ze-smartemailingu" },
    orderBy: { at: "desc" },
    take: 20,
    select: { id: true, entityId: true, at: true, userId: true },
  });
  if (zaznamy.length === 0) return [];

  const [klienti, lide] = await Promise.all([
    db.client.findMany({
      where: { id: { in: zaznamy.map((zaznam) => zaznam.entityId) } },
      select: { id: true, name: true, email: true, deletedAt: true },
    }),
    db.user.findMany({
      where: { id: { in: zaznamy.flatMap((zaznam) => (zaznam.userId ? [zaznam.userId] : [])) } },
      select: { id: true, name: true },
    }),
  ]);

  return zaznamy.map((zaznam) => {
    const klient = klienti.find((k) => k.id === zaznam.entityId);
    return {
      id: zaznam.id,
      clientId: zaznam.entityId,
      name: klient?.name ?? "Neznámý klient",
      email: klient?.email ?? null,
      smazany: Boolean(klient?.deletedAt),
      at: zaznam.at,
      kdo: zaznam.userId
        ? (lide.find((clovek) => clovek.id === zaznam.userId)?.name ?? "—")
        : KDO_WEBHOOK,
    };
  });
}

/**
 * Klienti, jejichž e-mail SmartEmailing hlásí jako nedoručitelný — seznam
 * Špatný e-mail. Souhlas jim zůstává; značka zmizí opravou e-mailu na kartě.
 */
export async function nactiNedorucitelne() {
  const klienti = await db.client.findMany({
    where: { deletedAt: null, smartemailingBouncedAt: { not: null } },
    orderBy: { smartemailingBouncedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      smartemailingBouncedAt: true,
    },
  });

  return klienti.map((klient) => ({
    clientId: klient.id,
    name: klient.name,
    email: klient.email,
    at: klient.smartemailingBouncedAt,
  }));
}
