import type { CallToolResult, McpServer, ToolCallback } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { nactiSeznamAktivity, nactiSouhrnAktivity, zapisUdalostPozdeji } from "@/lib/aktivita";
import { nactiChyby, POPIS_DRUHU_CHYBY, type DruhChyby } from "@/lib/chyby";
import { nactiPlneniCilu } from "@/lib/cile";
import { db } from "@/lib/db";
import { cenaPolozkyBezDph } from "@/lib/dph";
import { klientiPodleTelefonu, klientiPodleTextu } from "@/lib/hledani";
import { casVPraze, chybaNastroje, odpovedNastroje } from "@/lib/mcp/vystup";
import { zapisPoznamku } from "@/lib/poznamky";
import { nastavHotovoUkolu, zalozUkolProKlienta } from "@/lib/ukoly";
import { jakoDen, posunDne, prectiDen, prectiObdobi, PREDVOLBY, type IdObdobi } from "@/lib/obdobi";
import { dnesniZacatek } from "@/lib/platnost";
import {
  nactiBrokery,
  nactiDashboard,
  nactiMojeUkoly,
  nactiObjednavky,
  nactiPlatnostiKlienta,
  nactiPoznamkyKlienta,
  nactiProdukty,
  nactiZdrojeKlientu,
  viditelniKlienti,
  viditelneObjednavky,
  type ObjednavkaKZobrazeni,
} from "@/lib/queries";
import type { Viewer } from "@/lib/session";
import { POPIS_CHYBY_SMARTEMAILINGU } from "@/lib/smartemailing";
import { nactiPrehledSynchronizace } from "@/lib/smartemailing-synchronizace";
import {
  AUTO_CONNECT_LABEL,
  ORDER_STATUS_LABEL,
  PRODUCT_KIND_LABEL,
  PROGRAM_ACCESS_LABEL,
  ROLE_LABEL,
  STAGE_LABEL,
} from "@/lib/types";

/**
 * Nástroje MCP serveru CRM (Jakub, 27. 9. 2026).
 *
 * **Hlavně čtení.** Klíč se zaškrtnutým „smí zapisovat“ dostane navíc tři
 * nástroje pro zápis (Jakub, 5. 10. 2026): přidat poznámku ke klientovi,
 * založit úkol a odškrtnout úkol. Jdou přes stejné funkce jako CRM
 * (`src/lib/poznamky.ts`, `src/lib/ukoly.ts`), takže platí stejná pravidla
 * a stejný audit, a v CRM mají značku „přes AI“. Klíč jen ke čtení je
 * vůbec nevidí. Mazání, úpravy, hesla, klíče, Nastavení a správa
 * uživatelů přes MCP nebudou nikdy (mazání má v CRM vždy potvrzovací okno
 * a to AI obejít nesmí).
 *
 * **Oprávnění:** každý nástroj čte přes `viditelniKlienti()` /
 * `viditelneObjednavky()` s viewerem majitele klíče, takže AI vidí
 * přesně to, co ten člověk v CRM (security_warnings.md, pravidlo 4).
 * Nástroje ze sekcí jen pro administrátora se registrují jen
 * administrátorovi — a klíč dnes stejně platí jen jemu (`klice.ts`).
 *
 * **Bez e-mailů a telefonů:** nástroje je z databáze nečtou a každá
 * odpověď navíc projde `odpovedNastroje()` (`vystup.ts`).
 */

const idSchema = z.string().trim().min(1).max(64);
const limitSchema = (vychozi: number) => z.number().int().min(1).max(200).default(vychozi);

/** Datum ve tvaru RRRR-MM-DD, zkontrolované stejně jako v adrese. */
const denSchema = z.string().max(10).describe("Datum ve tvaru RRRR-MM-DD (pražský čas)").optional();

const obdobiSchema = {
  obdobi: z
    .enum(PREDVOLBY.map((predvolba) => predvolba.id) as [IdObdobi, ...IdObdobi[]])
    .default("30dni")
    .describe("7dni, 30dni, tento-mesic, minuly-mesic, letos, nebo vlastni (pak od a do)"),
  od: denSchema,
  do: denSchema,
};

function obdobiZVstupu(vstup: { obdobi: IdObdobi; od?: string; do?: string }) {
  const obdobi = prectiObdobi({ obdobi: vstup.obdobi, od: vstup.od, do: vstup.do });
  return {
    obdobi,
    popis: {
      nazev: obdobi.label,
      od: obdobi.prvniDen,
      do: obdobi.posledniDen,
      ...(obdobi.odmitnutyRozsah
        ? { upozorneni: "Zadaný rozsah nešel použít, použilo se posledních 30 dní." }
        : {}),
    },
  };
}

const JEN_CTENI = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** Zápis, který nic nemaže ani nepřepisuje — jen přidává, nebo odškrtává. */
const ZAPIS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Klient, kterého viewer smí vidět, jinak `null` — stejně jako 404 v CRM. */
async function viditelnyKlient(viewer: Viewer, id: string) {
  return db.client.findFirst({
    where: { AND: [{ id }, viditelniKlienti(viewer)] },
    select: { id: true, name: true },
  });
}

const NENALEZENO = "Klient nenalezen. Id vrací nástroj hledat_klienty.";

/** Objednávka tak, jak jde do AI — bez interního id položek. */
function objednavkaVen(objednavka: ObjednavkaKZobrazeni) {
  return {
    cislo: objednavka.number,
    stav: ORDER_STATUS_LABEL[objednavka.status],
    klient: { id: objednavka.clientId, jmeno: objednavka.clientName },
    vytvorena: objednavka.createdAt,
    zaplacena: objednavka.paidAt,
    hodnotaBezDph: objednavka.hodnota,
    hodnotaSDph: objednavka.hodnotaSDph,
    mena: objednavka.currency,
    poznamka: objednavka.note,
    produkty: objednavka.produkty.map((produkt) => ({
      nazev: produkt.name,
      druh: PRODUCT_KIND_LABEL[produkt.kind],
      kusu: produkt.quantity,
      cenaZaKusBezDph: produkt.cenaBezDph,
      cenaZaKusSDph: produkt.cenaSDph,
    })),
  };
}

export function zaregistrujNastroje(
  server: McpServer,
  viewer: Viewer,
  {
    smiZapisovat = false,
    zapisovatAktivitu = true,
  }: {
    smiZapisovat?: boolean;
    /**
     * Asistent AI v CRM (`src/lib/asistent/`) si do Aktivity zapisuje
     * jeden řádek za otázku sám, ne každé volání nástroje.
     */
    zapisovatAktivitu?: boolean;
  } = {},
): void {
  /**
   * Obal kolem každého nástroje: zápis do Aktivity a zachycení chyby.
   *
   * Do Aktivity jde jen **název nástroje** (a klient, kterého se týkal),
   * nikdy obsah dotazu — v hledání bývají jména (pravidlo 8).
   */
  function nastroj<Tvar extends z.ZodRawShape>(
    nazev: string,
    popis: { titulek: string; popis: string; zapis?: boolean },
    vstup: Tvar,
    obsluha: (argumenty: z.infer<z.ZodObject<Tvar>>) => Promise<
      | {
          data: unknown;
          klientId?: string;
        }
      | { chyba: string }
    >,
  ) {
    const obsluz = async (argumenty: z.infer<z.ZodObject<Tvar>>): Promise<CallToolResult> => {
      try {
        const vysledek = await obsluha(argumenty);
        if (zapisovatAktivitu)
          zapisUdalostPozdeji({
            userId: viewer.id,
            kind: "MCP",
            detail: nazev,
            ...("klientId" in vysledek && vysledek.klientId ? { clientId: vysledek.klientId } : {}),
          });
        return "chyba" in vysledek ? chybaNastroje(vysledek.chyba) : odpovedNastroje(vysledek.data);
      } catch (chyba) {
        // Jen druh chyby — hlášení z databáze může nést hodnoty ze záznamu.
        console.error(
          `Nástroj MCP ${nazev} selhal:`,
          chyba instanceof Error ? chyba.name : "neznámá chyba",
        );
        return chybaNastroje("Nástroj se nepodařilo provést. Zkus to prosím znovu.");
      }
    };

    server.registerTool(
      nazev,
      {
        title: popis.titulek,
        description: popis.popis,
        // MCP 2 chce celé schéma, ne jen jeho pole (18. 10. 2026).
        inputSchema: z.object(vstup),
        annotations: popis.zapis ? ZAPIS : JEN_CTENI,
      },
      // SDK odvozuje typ argumentů ze schématu a s obecným `Tvar` si ho
      // TypeScript nespojí. Argumenty SDK před voláním ověří schématem,
      // návratový typ hlídá `CallToolResult` výš.
      obsluz as unknown as ToolCallback<z.ZodObject<Tvar>>,
    );
  }

  /* ---------- Klienti ---------- */

  nastroj(
    "hledat_klienty",
    {
      titulek: "Hledat klienty",
      popis:
        "Seznam klientů CRM, nejnovější objednávka první. Hledá ve jméně, e-mailu i telefonu " +
        "(bez ohledu na diakritiku a mezery), ale e-mail ani telefon ve výsledku nejsou. " +
        "Vrací id klienta pro další nástroje.",
    },
    {
      hledat: z.string().trim().max(100).optional().describe("Jméno, e-mail nebo telefon"),
      pristup: z.enum(["POVOLEN", "NEPOVOLEN"]).optional().describe("Přístup do programu"),
      souhlasMarketing: z.boolean().optional().describe("Jen se souhlasem (true) / bez (false)"),
      stitek: z.string().trim().max(40).optional().describe("Jen klienti s tímto štítkem (název)"),
      platnost: z
        .enum(["bezi", "skoncila", "zadna"])
        .optional()
        .describe("bezi = něco mu platí, skoncila = vše skončilo, zadna = nikdy nic neměl"),
      limit: limitSchema(50),
    },
    async (vstup) => {
      const dnes = dnesniZacatek();
      const podminky: Prisma.ClientWhereInput[] = [viditelniKlienti(viewer)];

      if (vstup.hledat) {
        const [podleTextu, podleTelefonu] = await Promise.all([
          klientiPodleTextu(vstup.hledat),
          klientiPodleTelefonu(vstup.hledat),
        ]);
        podminky.push({ id: { in: [...podleTextu, ...podleTelefonu] } });
      }
      if (vstup.pristup) podminky.push({ programAccess: vstup.pristup });
      // Štítek podle názvu (Fáze 5B, 11. 10. 2026).
      if (vstup.stitek) {
        podminky.push({
          stitky: {
            some: { tag: { deletedAt: null, name: { equals: vstup.stitek, mode: "insensitive" } } },
          },
        });
      }
      if (vstup.souhlasMarketing !== undefined) {
        podminky.push({ consentMarketingAt: vstup.souhlasMarketing ? { not: null } : null });
      }
      if (vstup.platnost === "bezi") {
        podminky.push({ platnosti: { some: { validUntil: { gte: dnes } } } });
      } else if (vstup.platnost === "skoncila") {
        podminky.push(
          { platnosti: { some: { validUntil: { not: null } } } },
          { platnosti: { none: { validUntil: { gte: dnes } } } },
        );
      } else if (vstup.platnost === "zadna") {
        podminky.push({ platnosti: { none: { validUntil: { not: null } } } });
      }

      const klienti = await db.client.findMany({
        where: { AND: podminky },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          programAccess: true,
          consentMarketingAt: true,
          createdAt: true,
          source: { select: { name: true } },
          orders: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, status: true },
          },
          platnosti: { where: { validUntil: { not: null } }, select: { validUntil: true } },
          stitky: {
            where: { tag: { deletedAt: null } },
            select: { tag: { select: { name: true } } },
          },
        },
      });

      const radky = klienti
        .map((klient) => {
          const konce = klient.platnosti.map((radek) => radek.validUntil!.getTime());
          const bezici = konce.filter((konec) => konec >= dnes.getTime());
          return {
            id: klient.id,
            jmeno: klient.name,
            zdroj: klient.source.name,
            vSystemuOd: klient.createdAt,
            pristupDoProgramu: PROGRAM_ACCESS_LABEL[klient.programAccess],
            souhlasSMarketingem: klient.consentMarketingAt !== null,
            pocetObjednavek: klient.orders.length,
            posledniObjednavka: klient.orders[0]?.createdAt ?? null,
            zaplatil: klient.orders.some((objednavka) => objednavka.status === "ZAPLACENO"),
            platnostDo:
              konce.length === 0
                ? null
                : jakoDen(new Date(bezici.length ? Math.min(...bezici) : Math.max(...konce))),
            clenstviSkoncilo: konce.length > 0 && bezici.length === 0,
            stitky: klient.stitky.map((vazba) => vazba.tag.name),
          };
        })
        .sort(
          (a, b) =>
            (b.posledniObjednavka?.getTime() ?? -1) - (a.posledniObjednavka?.getTime() ?? -1),
        );

      return {
        data: {
          celkem: radky.length,
          zobrazeno: Math.min(radky.length, vstup.limit),
          klienti: radky.slice(0, vstup.limit),
        },
      };
    },
  );

  nastroj(
    "detail_klienta",
    {
      titulek: "Detail klienta",
      popis:
        "Všechno, co CRM o klientovi ví, kromě e-mailu a telefonu: zdroj, stav, souhlasy, " +
        "přístup do programu, platnost členství, štítky, SmartEmailing, brokeři a souhrn objednávek.",
    },
    { klientId: idSchema },
    async ({ klientId }) => {
      const klient = await db.client.findFirst({
        where: { AND: [{ id: klientId }, viditelniKlienti(viewer)] },
        select: {
          id: true,
          name: true,
          stage: true,
          programAccess: true,
          createdAt: true,
          lastContactAt: true,
          consentMarketingAt: true,
          reportedBrokers: true,
          brokersReportedAt: true,
          smartemailingSentAt: true,
          smartemailingError: true,
          smartemailingListName: true,
          smartemailingBouncedAt: true,
          smartemailingUnsubscribedAt: true,
          smartemailingOptedOutAt: true,
          source: { select: { name: true } },
          stitky: {
            where: { tag: { deletedAt: null } },
            select: { tag: { select: { name: true } } },
          },
          orders: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            select: {
              createdAt: true,
              status: true,
              items: {
                select: {
                  quantity: true,
                  netPrice: true,
                  vatPercent: true,
                  product: { select: { netPrice: true } },
                },
              },
            },
          },
          _count: {
            select: {
              notes: { where: { deletedAt: null } },
            },
          },
        },
      });
      if (!klient) return { chyba: NENALEZENO };

      const platnosti = await nactiPlatnostiKlienta(viewer, klient.id);
      const zaplacene = klient.orders.filter((objednavka) => objednavka.status === "ZAPLACENO");
      const hodnota = (polozky: (typeof klient.orders)[number]["items"]) =>
        polozky.reduce((soucet, p) => soucet + p.quantity * cenaPolozkyBezDph(p), 0);

      return {
        klientId: klient.id,
        data: {
          id: klient.id,
          jmeno: klient.name,
          zdroj: klient.source.name,
          stitky: klient.stitky.map((vazba) => vazba.tag.name),
          stav: STAGE_LABEL[klient.stage],
          vSystemuOd: klient.createdAt,
          posledniKontakt: klient.lastContactAt,
          pristupDoProgramu: PROGRAM_ACCESS_LABEL[klient.programAccess],
          souhlasy: {
            marketing: klient.consentMarketingAt,
          },
          smartemailing: {
            odeslanDo: klient.smartemailingSentAt
              ? { kdy: klient.smartemailingSentAt, seznam: klient.smartemailingListName }
              : null,
            chyba: klient.smartemailingError
              ? (POPIS_CHYBY_SMARTEMAILINGU[
                  klient.smartemailingError as keyof typeof POPIS_CHYBY_SMARTEMAILINGU
                ] ?? klient.smartemailingError)
              : null,
            samSeOdhlasil: klient.smartemailingOptedOutAt,
            odhlasenCRM: klient.smartemailingUnsubscribedAt,
            nedorucitelnyEmail: klient.smartemailingBouncedAt,
          },
          brokerPodleKlienta: klient.brokersReportedAt
            ? {
                brokeri: klient.reportedBrokers,
                nemaBrokera: klient.reportedBrokers.length === 0,
                uvedeno: klient.brokersReportedAt,
              }
            : null,
          platnostClenstvi: platnosti.map((platnost) => ({
            produkt: platnost.produkt,
            platiDoVcetne: jakoDen(platnost.do),
            skoncilo: platnost.skoncilo,
          })),
          objednavky: {
            pocet: klient.orders.length,
            zaplacenych: zaplacene.length,
            posledni: klient.orders[0]?.createdAt ?? null,
            zaplacenoCelkemBezDph: zaplacene.reduce((soucet, o) => soucet + hodnota(o.items), 0),
          },
          pocetPoznamek: klient._count.notes,
        },
      };
    },
  );

  nastroj(
    "objednavky_klienta",
    {
      titulek: "Objednávky a produkty klienta",
      popis:
        "Všechny objednávky klienta s produkty a cenami a souhrn zakoupených (zaplacených) " +
        "produktů s platností členství.",
    },
    { klientId: idSchema },
    async ({ klientId }) => {
      const klient = await viditelnyKlient(viewer, klientId);
      if (!klient) return { chyba: NENALEZENO };

      const [objednavky, platnosti] = await Promise.all([
        nactiObjednavky(viewer, { klientId }),
        nactiPlatnostiKlienta(viewer, klientId),
      ]);

      const zakoupene = new Map<string, { produkt: string; kusu: number; bezDph: number }>();
      for (const objednavka of objednavky.filter((o) => o.status === "ZAPLACENO")) {
        for (const polozka of objednavka.produkty) {
          const radek = zakoupene.get(polozka.productId) ?? {
            produkt: polozka.name,
            kusu: 0,
            bezDph: 0,
          };
          radek.kusu += polozka.quantity;
          radek.bezDph += polozka.quantity * polozka.cenaBezDph;
          zakoupene.set(polozka.productId, radek);
        }
      }

      return {
        klientId,
        data: {
          klient: klient.name,
          zakoupeneProdukty: [...zakoupene.entries()].map(([productId, radek]) => {
            const platnost = platnosti.find((p) => p.productId === productId);
            return {
              produkt: radek.produkt,
              kusu: radek.kusu,
              zaplacenoBezDph: radek.bezDph,
              platiDoVcetne: platnost ? jakoDen(platnost.do) : null,
              skoncilo: platnost?.skoncilo ?? null,
            };
          }),
          objednavky: objednavky.map(objednavkaVen),
        },
      };
    },
  );

  nastroj(
    "poznamky_klienta",
    {
      titulek: "Poznámky u klienta",
      popis:
        "Poznámky týmu u klienta od nejnovější. Autor „web a objednávky“ = zápis systému. " +
        "Telefony a e-maily v textu jsou začerněné.",
    },
    { klientId: idSchema },
    async ({ klientId }) => {
      const klient = await viditelnyKlient(viewer, klientId);
      if (!klient) return { chyba: NENALEZENO };

      const poznamky = await nactiPoznamkyKlienta(viewer, klientId);
      return {
        klientId,
        data: {
          klient: klient.name,
          poznamky: poznamky.map((poznamka) => ({
            kdy: poznamka.createdAt,
            autor: poznamka.authorName ?? "web a objednávky",
            text: poznamka.text,
          })),
        },
      };
    },
  );

  nastroj(
    "prilohy_klienta",
    {
      titulek: "Přílohy klienta",
      popis: "Seznam souborů u klienta (název, typ, velikost, kdo a kdy nahrál). Obsah souborů ne.",
    },
    { klientId: idSchema },
    async ({ klientId }) => {
      const klient = await viditelnyKlient(viewer, klientId);
      if (!klient) return { chyba: NENALEZENO };

      const soubory = await db.attachment.findMany({
        where: { ownerType: "KLIENT", ownerId: klient.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          name: true,
          mimeType: true,
          size: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      });

      return {
        klientId,
        data: {
          klient: klient.name,
          prilohy: soubory.map((soubor) => ({
            nazev: soubor.name,
            typ: soubor.mimeType,
            velikostKB: Math.round(soubor.size / 1024),
            nahral: soubor.uploadedBy.name,
            kdy: soubor.createdAt,
          })),
        },
      };
    },
  );

  /* ---------- Objednávky a produkty ---------- */

  nastroj(
    "seznam_objednavek",
    {
      titulek: "Seznam objednávek",
      popis:
        "Objednávky od nejnovější s filtry: text (číslo, klient, produkt), stav, časový " +
        "rozsah podle vytvoření objednávky, klient. Částky v Kč bez DPH i s DPH.",
    },
    {
      hledat: z.string().trim().max(100).optional(),
      stav: z.enum(["NOVA", "NEZAPLACENO", "ZAPLACENO"]).optional(),
      od: denSchema,
      do: denSchema.describe("Poslední den včetně, RRRR-MM-DD"),
      klientId: idSchema.optional(),
      limit: limitSchema(50),
    },
    async (vstup) => {
      const od = vstup.od ? prectiDen(vstup.od) : null;
      const doDne = vstup.do ? prectiDen(vstup.do) : null;
      if ((vstup.od && !od) || (vstup.do && !doDne)) {
        return { chyba: "Datum musí být skutečný den ve tvaru RRRR-MM-DD." };
      }

      const objednavky = await nactiObjednavky(viewer, {
        hledat: vstup.hledat,
        stav: vstup.stav,
        klientId: vstup.klientId,
        od: od ?? undefined,
        do: doDne ? posunDne(doDne, 1) : undefined,
      });

      return {
        data: {
          celkem: objednavky.length,
          zobrazeno: Math.min(objednavky.length, vstup.limit),
          hodnotaCelkemBezDph: objednavky.reduce((soucet, o) => soucet + o.hodnota, 0),
          objednavky: objednavky.slice(0, vstup.limit).map(objednavkaVen),
        },
      };
    },
  );

  nastroj(
    "detail_objednavky",
    {
      titulek: "Detail objednávky",
      popis: "Jedna objednávka podle čísla ve tvaru RRRR-NNNN (např. 2026-0042).",
    },
    {
      cislo: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{4,6}$/, "Číslo má tvar RRRR-NNNN."),
    },
    async ({ cislo }) => {
      const objednavka = (await nactiObjednavky(viewer, { hledat: cislo })).find(
        (kandidat) => kandidat.number === cislo,
      );
      if (!objednavka) return { chyba: "Objednávka s tímhle číslem v CRM není." };

      return {
        klientId: objednavka.clientId,
        data: objednavkaVen(objednavka),
      };
    },
  );

  nastroj(
    "cenik",
    {
      titulek: "Ceník produktů",
      popis:
        "Produkty v ceníku: cena bez DPH a s DPH, sazba, délka platnosti v měsících, " +
        "jestli se prodává a kolik kusů se prodalo (v zaplacených objednávkách).",
    },
    {},
    async () => {
      const produkty = await nactiProdukty();
      return {
        data: produkty.map((produkt) => ({
          id: produkt.id,
          nazev: produkt.name,
          druh: PRODUCT_KIND_LABEL[produkt.kind],
          cenaBezDph: produkt.cenaBezDph,
          cenaSDph: produkt.cenaSDph,
          sazbaDph: `${produkt.sazbaNazev} (${produkt.sazba} %)`,
          mena: produkt.currency,
          vProdeji: produkt.active,
          platnostMesicu: produkt.validityMonths,
          prodanoKusu: produkt.prodano,
          odkaz: produkt.url,
        })),
      };
    },
  );

  nastroj(
    "brokeri",
    {
      titulek: "Katalog brokerů",
      popis: "Brokeři v katalogu CRM a jestli umí vydat klíč jen pro čtení.",
    },
    {},
    async () => {
      const brokeri = await nactiBrokery();
      return {
        data: brokeri.map((broker) => ({
          nazev: broker.name,
          klicJenProCteni: AUTO_CONNECT_LABEL[broker.autoConnect],
          web: broker.website,
          poznamka: broker.note,
        })),
      };
    },
  );

  /* ---------- Statistiky ---------- */

  nastroj(
    "statistiky_objednavek",
    {
      titulek: "Statistiky objednávek",
      popis:
        "Čísla za období jako na Dashboardu: počet a hodnota objednávek proti předchozímu " +
        "stejně dlouhému úseku, stavy objednávek, tržby ze zaplacených (podle data platby), " +
        "nejprodávanější produkty, noví klienti podle zdroje, vývoj v čase a plnění cíle " +
        "tento měsíc. Vše v Kč bez DPH.",
    },
    obdobiSchema,
    async (vstup) => {
      const { obdobi, popis } = obdobiZVstupu(vstup);

      const [dashboard, zaplacene, plneni] = await Promise.all([
        nactiDashboard(viewer, obdobi),
        db.order.findMany({
          where: {
            AND: [
              viditelneObjednavky(viewer),
              { status: "ZAPLACENO", paidAt: { gte: obdobi.od, lt: obdobi.do } },
            ],
          },
          select: {
            items: {
              select: {
                quantity: true,
                netPrice: true,
                vatPercent: true,
                product: { select: { id: true, name: true, netPrice: true } },
              },
            },
          },
        }),
        nactiPlneniCilu(viewer),
      ]);

      const produkty = new Map<string, { produkt: string; kusu: number; trzbyBezDph: number }>();
      for (const objednavka of zaplacene) {
        for (const polozka of objednavka.items) {
          const radek = produkty.get(polozka.product.id) ?? {
            produkt: polozka.product.name,
            kusu: 0,
            trzbyBezDph: 0,
          };
          radek.kusu += polozka.quantity;
          radek.trzbyBezDph += polozka.quantity * cenaPolozkyBezDph(polozka);
          produkty.set(polozka.product.id, radek);
        }
      }
      const podleProduktu = [...produkty.values()].sort((a, b) => b.trzbyBezDph - a.trzbyBezDph);
      const firma = plneni.radky[0];

      return {
        data: {
          obdobi: popis,
          objednavky: {
            vytvorenych: dashboard.soucasnost.objednavky,
            hodnotaBezDph: dashboard.soucasnost.hodnota,
            predchoziObdobi: {
              vytvorenych: dashboard.minulost.objednavky,
              hodnotaBezDph: dashboard.minulost.hodnota,
            },
            podleStavu: dashboard.objednavkyPodleStavu.map((radek) => ({
              stav: radek.label,
              pocet: radek.pocet,
              hodnotaBezDph: radek.hodnota,
            })),
          },
          zaplaceno: {
            objednavek: zaplacene.length,
            trzbyBezDph: podleProduktu.reduce((soucet, radek) => soucet + radek.trzbyBezDph, 0),
            podleProduktu,
          },
          noviKlientiPodleZdroje: dashboard.podleZdroje.map((radek) => ({
            zdroj: radek.label,
            pocet: radek.pocet,
          })),
          vyvoj: dashboard.vyvoj.map((bod) => ({
            usek: bod.popisek,
            objednavek: bod.objednavky,
            hodnotaBezDph: bod.hodnota,
          })),
          cilTentoMesic: {
            mesic: plneni.popis,
            cilBezDph: firma?.cil ?? 0,
            trzbyBezDph: firma?.trzby ?? 0,
            bezCile: !firma?.cil,
          },
        },
      };
    },
  );

  nastroj(
    "prehled_clenstvi",
    {
      titulek: "Přehled členství a přístupů",
      popis:
        "Klienti, kteří zaplatili a nemají přístup do programu; klienti, kterým skončilo " +
        "členství a přístup mají dál; a komu členství skončí v příštích N dnech.",
    },
    { dni: z.number().int().min(1).max(365).default(30).describe("Kolik dní dopředu") },
    async ({ dni }) => {
      const dnes = dnesniZacatek();
      const hranice = posunDne(dnes, dni + 1);

      const [cekajici, poKonci, konci] = await Promise.all([
        db.client.findMany({
          where: {
            AND: [
              viditelniKlienti(viewer),
              { programAccess: "NEPOVOLEN" },
              { orders: { some: { status: "ZAPLACENO", deletedAt: null } } },
            ],
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        db.client.findMany({
          where: {
            AND: [
              viditelniKlienti(viewer),
              { programAccess: "POVOLEN" },
              { platnosti: { some: { validUntil: { not: null } } } },
              { platnosti: { none: { validUntil: { gte: dnes } } } },
            ],
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        db.productValidity.findMany({
          where: {
            AND: [{ validUntil: { gte: dnes, lt: hranice } }, { client: viditelniKlienti(viewer) }],
          },
          orderBy: { validUntil: "asc" },
          select: {
            validUntil: true,
            client: { select: { id: true, name: true, programAccess: true } },
            product: { select: { name: true } },
          },
        }),
      ]);

      return {
        data: {
          zaplatiliBezPristupu: cekajici.map((k) => ({ id: k.id, jmeno: k.name })),
          poKonciClenstviSPristupem: poKonci.map((k) => ({ id: k.id, jmeno: k.name })),
          [`konciDo${dni}Dni`]: konci.map((radek) => ({
            id: radek.client.id,
            jmeno: radek.client.name,
            produkt: radek.product.name,
            platiDoVcetne: jakoDen(radek.validUntil!),
            pristupDoProgramu: PROGRAM_ACCESS_LABEL[radek.client.programAccess],
          })),
        },
      };
    },
  );

  nastroj(
    "zdroje_klientu",
    {
      titulek: "Zdroje klientů",
      popis: "Odkud se o nás klienti dozvěděli a kolik klientů má každý zdroj.",
    },
    {},
    async () => {
      const zdroje = await nactiZdrojeKlientu();
      return {
        data: zdroje.map((zdroj) => ({
          zdroj: zdroj.name,
          klientu: zdroj.klientu,
          aktivni: zdroj.active,
        })),
      };
    },
  );

  /* ---------- Úkoly ---------- */

  nastroj(
    "moje_ukoly",
    {
      titulek: "Moje úkoly",
      popis:
        "Nehotové úkoly majitele klíče, nejbližší termín první, s příznakem po termínu. " +
        "Id úkolu použij v odskrtnout_ukol.",
    },
    {},
    async () => {
      const dnes = dnesniZacatek().getTime();
      const zitra = posunDne(dnesniZacatek(), 1).getTime();
      const ukoly = await nactiMojeUkoly(viewer);
      return {
        data: ukoly.map((ukol) => ({
          id: ukol.id,
          ukol: ukol.title,
          termin: jakoDen(ukol.dueAt),
          stav:
            ukol.dueAt.getTime() < dnes
              ? "po termínu"
              : ukol.dueAt.getTime() < zitra
                ? "dnes"
                : "později",
          klient: { id: ukol.clientId, jmeno: ukol.clientName },
        })),
      };
    },
  );

  /* ---------- Jen administrátor ---------- */

  if (viewer.role !== "ADMINISTRATOR") return;

  nastroj(
    "prihlaseni_tymu",
    {
      titulek: "Přihlášení týmu",
      popis:
        "Jen administrátor. Kdo z týmu se za období přihlásil: poslední přihlášení, počet " +
        "sezení, odhad času v aplikaci, neúspěšné pokusy, a posledních 50 přihlášení " +
        "a odhlášení. (Klienti se do systému zatím nepřihlašují.)",
    },
    obdobiSchema,
    async (vstup) => {
      const { obdobi, popis } = obdobiZVstupu(vstup);
      const [souhrn, seznam] = await Promise.all([
        nactiSouhrnAktivity(obdobi),
        nactiSeznamAktivity({ obdobi, druh: "prihlaseni", stranka: 1 }),
      ]);

      return {
        data: {
          obdobi: popis,
          lide: souhrn.map((clovek) => ({
            jmeno: clovek.name,
            role: ROLE_LABEL[clovek.role],
            smazany: clovek.smazany,
            posledniPrihlaseni: clovek.posledniPrihlaseni,
            sezeni: clovek.sezeni,
            minutVAplikaci: Math.round(clovek.minutVAplikaci),
            neuspesnychPokusu: clovek.neuspesnych,
          })),
          poslednichUdalosti: seznam.zaznamy.map((zaznam) => ({
            kdy: zaznam.at,
            kdo: zaznam.kdo,
            co: zaznam.titulek,
            duvod: zaznam.popis,
          })),
        },
      };
    },
  );

  nastroj(
    "auditni_log",
    {
      titulek: "Auditní log",
      popis: "Jen administrátor. Kdo co v CRM změnil, od nejnovější změny, po 50 na stránku.",
    },
    { ...obdobiSchema, stranka: z.number().int().min(1).max(100).default(1) },
    async (vstup) => {
      const { obdobi, popis } = obdobiZVstupu(vstup);
      const seznam = await nactiSeznamAktivity({ obdobi, druh: "zmeny", stranka: vstup.stranka });
      return {
        data: {
          obdobi: popis,
          celkem: seznam.celkem,
          stranka: vstup.stranka,
          stranek: seznam.stranek,
          zmeny: seznam.zaznamy.map((zaznam) => ({
            kdy: zaznam.at,
            kdo: zaznam.kdo,
            co: zaznam.titulek,
            ceho: zaznam.popis,
          })),
        },
      };
    },
  );

  nastroj(
    "chyby",
    {
      titulek: "Chyby napojení",
      popis:
        "Jen administrátor. Co se pokazilo při volání mimo CRM (SmartEmailing, e-maily, " +
        "leady, objednávky z Landing Page).",
    },
    { stav: z.enum(["otevrene", "vyresene", "vse"]).default("otevrene") },
    async ({ stav }) => {
      const { pocet, nevyresenych, chyby } = await nactiChyby({ stav, skupina: "vse" });
      return {
        data: {
          celkem: pocet,
          nevyresenych,
          chyby: chyby.map((chyba) => ({
            druh: POPIS_DRUHU_CHYBY[chyba.kind as DruhChyby] ?? chyba.kind,
            kod: chyba.code,
            popis: chyba.detail,
            poprve: chyba.createdAt,
            naposledy: chyba.lastAt,
            pokusu: chyba.attempts,
            klient: chyba.client && !chyba.client.deletedAt ? chyba.client.name : null,
            uzivatel: chyba.user && !chyba.user.deletedAt ? chyba.user.name : null,
            vyreseno: chyba.resolvedAt
              ? { kdy: chyba.resolvedAt, jak: chyba.resolution, kdo: chyba.resolvedBy?.name }
              : null,
          })),
        },
      };
    },
  );

  nastroj(
    "smartemailing_prehled",
    {
      titulek: "Přehled SmartEmailingu",
      popis:
        "Jen administrátor. Kolik klientů odešlo do SmartEmailingu, kolik čeká, kolik má " +
        "chybu, kolik se samo odhlásilo a kolik má nedoručitelný e-mail.",
    },
    {},
    async () => {
      const [prehled, odhlaseni, nedorucitelni] = await Promise.all([
        nactPrehled(),
        db.client.count({ where: { deletedAt: null, smartemailingOptedOutAt: { not: null } } }),
        db.client.count({ where: { deletedAt: null, smartemailingBouncedAt: { not: null } } }),
      ]);
      return {
        data: {
          odeslano: prehled.odeslano,
          cekaNaOdeslani: prehled.cekajici,
          sChybou: prehled.chyby,
          samiSeOdhlasili: odhlaseni,
          nedorucitelnyEmail: nedorucitelni,
          hromadneOdeslaniBezi: prehled.hromadneBezi,
        },
      };
    },
  );

  nastroj(
    "tym",
    {
      titulek: "Tým",
      popis:
        "Jen administrátor. Činní členové týmu: id, jméno a role. Id použij v zalozit_ukol " +
        "jako komu, když má úkol dostat kolega.",
    },
    {},
    async () => {
      const lide = await db.user.findMany({
        where: { active: true, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      });
      return {
        data: lide.map((clovek) => ({
          id: clovek.id,
          jmeno: clovek.name,
          role: ROLE_LABEL[clovek.role],
          jaTo: clovek.id === viewer.id,
        })),
      };
    },
  );

  /* ---------- Zápis (jen klíč se zaškrtnutým „smí zapisovat“) ---------- */

  if (!smiZapisovat) return;

  nastroj(
    "pridat_poznamku",
    {
      titulek: "Přidat poznámku ke klientovi",
      popis:
        "Zapíše poznámku do okna Poznámky na kartě klienta, jako autor majitel klíče, se " +
        "značkou „přes AI“. Nejde vzít zpět jinak než ručně v CRM — zapisuj jen to, co " +
        "uživatel výslovně chce. Id klienta vrací hledat_klienty.",
      zapis: true,
    },
    {
      klientId: idSchema,
      text: z.string().max(5000).describe("Text poznámky, nejvýš 5000 znaků"),
    },
    async (vstup) => {
      const vysledek = await zapisPoznamku(viewer, vstup.klientId, vstup.text, { presMcp: true });
      if (!vysledek.ok) return { chyba: vysledek.chyba };
      return {
        data: { zapsano: true, poznamkaId: vysledek.id },
        klientId: vysledek.klientId,
      };
    },
  );

  nastroj(
    "zalozit_ukol",
    {
      titulek: "Založit úkol",
      popis:
        "Založí úkol u klienta do Mého dne — majiteli klíče, nebo kolegovi (komu = id z " +
        "nástroje tym). Termín je povinný. V CRM má značku „přes AI“. Zakládej jen úkoly, " +
        "které uživatel výslovně chce.",
      zapis: true,
    },
    {
      klientId: idSchema,
      nazev: z.string().max(200).describe("Co je potřeba udělat, nejvýš 200 znaků"),
      termin: z.string().max(10).describe("Termín ve tvaru RRRR-MM-DD (pražský čas)"),
      komu: idSchema
        .optional()
        .describe("Id kolegy z nástroje tym; bez něj úkol dostane majitel klíče"),
    },
    async (vstup) => {
      const vysledek = await zalozUkolProKlienta(
        viewer,
        { clientId: vstup.klientId, title: vstup.nazev, dueAt: vstup.termin, userId: vstup.komu },
        { presMcp: true },
      );
      if (!vysledek.ok) return { chyba: vysledek.chyba };
      return {
        data: { zalozeno: true, ukolId: vysledek.id, klient: vysledek.klientJmeno },
        klientId: vysledek.klientId,
      };
    },
  );

  nastroj(
    "odskrtnout_ukol",
    {
      titulek: "Odškrtnout úkol",
      popis:
        "Označí úkol jako hotový (nebo s hotovo = false vrátí mezi čekající). Id úkolu " +
        "vrací moje_ukoly. Úkol se nemaže.",
      zapis: true,
    },
    {
      ukolId: idSchema,
      hotovo: z.boolean().default(true),
    },
    async (vstup) => {
      const vysledek = await nastavHotovoUkolu(viewer, vstup.ukolId, vstup.hotovo, {
        presMcp: true,
      });
      if (!vysledek.ok) return { chyba: vysledek.chyba };
      return {
        data: { hotovo: vstup.hotovo, klient: vysledek.klientJmeno },
        klientId: vysledek.klientId,
      };
    },
  );
}

/** Přehled bez náhledu jmen — ten je jen pro potvrzovací okno v CRM. */
async function nactPrehled() {
  const { nahledCekajicich: _nahled, ...zbytek } = await nactiPrehledSynchronizace();
  void _nahled;
  return zbytek;
}

/** Popis serveru, který AI dostane při připojení. */
export function instrukceServeru(viewer: Viewer, smiZapisovat = false): string {
  return [
    smiZapisovat
      ? "CRM Beat Stock Market — čtení a zápis poznámek a úkolů. " +
        "Zapisuj jen to, o co tě uživatel výslovně požádá; mazat ani upravovat nejde."
      : "CRM Beat Stock Market — jen čtení.",
    `Data vidíš stejně jako ${viewer.name} (${ROLE_LABEL[viewer.role]}).`,
    "E-maily a telefony klientů ani kolegů záměrně nedostaneš; hledat podle nich jde.",
    "Časy jsou v pražském čase (RRRR-MM-DD HH:MM), částky v Kč, pokud není řečeno jinak bez DPH.",
    "Klienta najdi přes hledat_klienty a jeho id použij v dalších nástrojích.",
    `Vygenerováno ${casVPraze(new Date())}.`,
  ].join(" ");
}
