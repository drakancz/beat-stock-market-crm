import { zapisDoAuditu } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDatum, formatDatumCas, formatMoney, formatTelefon } from "@/lib/format";
import { nactiPrehledKlienta } from "@/lib/klient/data";
import { nactiDoporuceniKlienta } from "@/lib/klient/doporuceni";
import { vytvorPdfMojichUdaju } from "@/lib/klient/moje-udaje-pdf";
import { getKlient } from "@/lib/klient/sezeni";
import { nactiNastaveni } from "@/lib/nastaveni";
import { ORDER_STATUS_LABEL, PRODUCT_KIND_LABEL, PROGRAM_ACCESS_LABEL } from "@/lib/types";
import { vytvorPocitadlo } from "@/lib/verejne-api";
import { POPIS_ODZNAKU, popisTydne } from "@/lib/vzdelavani/odznaky";

/**
 * „Moje údaje ke stažení“ v klientské části (Jakub, 21. 10. 2026) —
 * právo klienta na kopii údajů a jejich přenositelnost (čl. 15 a 20 GDPR),
 * které slibují zásady.
 *
 * **Stahuje jen klient sám, jen sebe** — vše podle `clientId` z přihlášení.
 * Tým ani nepřihlášený se k souboru nedostane. Jeden obsah ve dvou
 * podobách: JSON (strojově čitelný) a PDF k přečtení; oba se skládají
 * z téhož `MojeUdaje`, takže se nemohou rozejít.
 *
 * **Co v souboru není (Jakub, 21. 10. 2026):** interní věci týmu —
 * poznámky, štítky, vlastní pole, úkoly, záznamy pravidel, chyby, audit
 * a jména kolegů. Kdyby si je klient výslovně vyžádal, vydá je
 * administrátor ručně. Nikdy ani heslo, tajemství dvoufázového ověření,
 * odkazy na heslo a adresy zařízení pro oznámení.
 *
 * Stejně jako v přehledu klientské části se neukazují smazané objednávky
 * a dotazy, které klient sám smazal.
 */

type Hodnota = string | number | boolean | null;
export type Zaznam = Record<string, Hodnota>;

export interface Oddil {
  nazev: string;
  /** Jeden záznam (osobní údaje) se v JSON ukáže jako objekt, jinak seznam. */
  jeden: boolean;
  zaznamy: Zaznam[];
}

export interface MojeUdaje {
  vytvoreno: Date;
  spravce: { nazev: string; kontakt: string | null };
  oddily: Oddil[];
}

/** Nejvýš 5 stažení za hodinu na účet — sestavení sahá do mnoha tabulek. */
export const pricistStazeni = vytvorPocitadlo({ limit: 5, oknoMs: 60 * 60 * 1000 });

const datum = (hodnota: Date | null | undefined) => (hodnota ? formatDatum(hodnota) : null);
const cas = (hodnota: Date | null | undefined) => (hodnota ? formatDatumCas(hodnota) : null);

export async function nactiMojeUdaje(
  clientId: string,
  accountId: string,
): Promise<MojeUdaje | null> {
  const [prehled, nastaveni, doporuceni, klient, ucet, objednavky] = await Promise.all([
    nactiPrehledKlienta(clientId),
    nactiNastaveni(),
    nactiDoporuceniKlienta(clientId),
    db.client.findUnique({
      where: { id: clientId },
      select: {
        createdAt: true,
        source: { select: { name: true } },
        reportedBrokers: true,
        brokersReportedAt: true,
        smartemailingUnsubscribedAt: true,
        billingName: true,
        billingStreet: true,
        billingCity: true,
        billingZip: true,
        billingCountry: true,
        billingIco: true,
        billingDic: true,
        referredById: true,
        hotoveLekce: {
          orderBy: { completedAt: "asc" },
          select: {
            completedAt: true,
            lesson: { select: { title: true, course: { select: { title: true } } } },
          },
        },
        hodnoceniLekci: {
          orderBy: { createdAt: "asc" },
          select: { stars: true, updatedAt: true, lesson: { select: { title: true } } },
        },
        pokusyKvizu: {
          orderBy: { createdAt: "asc" },
          select: {
            correct: true,
            total: true,
            passed: true,
            createdAt: true,
            quiz: { select: { lesson: { select: { title: true } } } },
          },
        },
        certifikaty: {
          orderBy: { issuedAt: "asc" },
          select: { number: true, courseTitle: true, clientName: true, issuedAt: true },
        },
        odznaky: { orderBy: { awardedAt: "asc" }, select: { kind: true, awardedAt: true } },
        aktivniTydny: { orderBy: { week: "asc" }, select: { week: true } },
        ucastNaWebinarich: {
          orderBy: { webinar: { startsAt: "asc" } },
          select: { webinar: { select: { title: true, startsAt: true } } },
        },
        dotazyKLekcim: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            text: true,
            createdAt: true,
            answer: true,
            answeredAt: true,
            lesson: { select: { title: true } },
          },
        },
        rezervace: {
          orderBy: { slot: { startsAt: "asc" } },
          select: {
            createdAt: true,
            cancelledAt: true,
            cancelledByClient: true,
            slot: { select: { startsAt: true, durationMinutes: true, place: true } },
          },
        },
        zpravy: {
          orderBy: { createdAt: "asc" },
          select: { text: true, createdAt: true, readAt: true },
        },
      },
    }),
    db.clientAccount.findUnique({
      where: { id: accountId },
      select: {
        invitedAt: true,
        passwordSetAt: true,
        lastLoginAt: true,
        lastSeenAt: true,
        twoFactorEnabled: true,
        notificationsEnabled: true,
        zarizeni: { orderBy: { createdAt: "asc" }, select: { device: true, createdAt: true } },
      },
    }),
    // Souhlas s obchodními podmínkami a odkud objednávka přišla — přehled je nenese.
    db.order.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, termsAcceptedAt: true, termsVersion: true, channel: true },
    }),
  ]);
  if (!prehled || !klient || !ucet) return null;

  const podminky = new Map(objednavky.map((o) => [o.id, o]));
  const { udaje } = prehled;
  const oddily: Oddil[] = [
    {
      nazev: "Osobní údaje",
      jeden: true,
      zaznamy: [
        {
          Jméno: udaje.name,
          "E-mail": udaje.email,
          Telefon: udaje.phone ? formatTelefon(udaje.phone) : null,
          "Klientem od": datum(klient.createdAt),
          "Odkud údaje máme": klient.source.name,
          "Brokeři, které jste uvedli": klient.reportedBrokers.join(", ") || null,
          "Brokery jste uvedli dne": datum(klient.brokersReportedAt),
          "Přístup do programu": PROGRAM_ACCESS_LABEL[udaje.programAccess],
          "Přišli jste na doporučení": klient.referredById !== null,
        },
      ],
    },
    {
      nazev: "Fakturační údaje",
      jeden: true,
      zaznamy: [
        {
          "Název nebo jméno": klient.billingName,
          Ulice: klient.billingStreet,
          Město: klient.billingCity,
          PSČ: klient.billingZip,
          Země: klient.billingCountry,
          IČO: klient.billingIco,
          DIČ: klient.billingDic,
        },
      ],
    },
    {
      nazev: "Souhlasy",
      jeden: true,
      zaznamy: [
        {
          "Souhlas se zasíláním novinek": udaje.consentMarketingAt ? "udělen" : "neudělen",
          "Souhlas udělen dne": datum(udaje.consentMarketingAt),
          "Odhlášení z e-mailů": datum(klient.smartemailingUnsubscribedAt),
        },
      ],
    },
    {
      nazev: "Účet v klientské části",
      jeden: true,
      zaznamy: [
        {
          "Pozvánka odeslána": datum(ucet.invitedAt),
          "Heslo nastaveno": datum(ucet.passwordSetAt),
          "Poslední přihlášení": cas(ucet.lastLoginAt),
          "Poslední návštěva": cas(ucet.lastSeenAt),
          "Dvoufázové ověření": ucet.twoFactorEnabled,
          "Upozornění zapnutá": ucet.notificationsEnabled,
        },
      ],
    },
    {
      nazev: "Zařízení s upozorněním",
      jeden: false,
      zaznamy: ucet.zarizeni.map((z) => ({ Zařízení: z.device, Přidáno: datum(z.createdAt) })),
    },
    {
      nazev: "Objednávky",
      jeden: false,
      zaznamy: prehled.objednavky.map((o) => {
        const navic = podminky.get(o.id);
        return {
          Číslo: o.number,
          Vytvořena: cas(o.createdAt),
          Stav: ORDER_STATUS_LABEL[o.status],
          Zaplacena: cas(o.paidAt),
          Položky: o.polozky
            .map((p) => `${p.quantity}× ${p.name} (${formatMoney(p.cenaSDph, o.currency)})`)
            .join("; "),
          "Slevový kód": o.sleva?.kod ?? null,
          "Celkem s DPH": formatMoney(o.celkemSDph, o.currency),
          Doklady: o.doklady.map((d) => d.number).join(", ") || null,
          Odkud: navic?.channel === "KLIENTSKA_CAST" ? "klientská část" : "web",
          "Obchodní podmínky odsouhlaseny": cas(navic?.termsAcceptedAt),
          "Verze podmínek": navic?.termsVersion ?? null,
        };
      }),
    },
    {
      nazev: "Členství a produkty",
      jeden: false,
      zaznamy: prehled.produkty.map((p) => ({
        Produkt: p.name,
        Druh: PRODUCT_KIND_LABEL[p.kind],
        "Platí do": p.do ? formatDatum(p.do) : "bez omezení",
      })),
    },
    {
      nazev: "Dokončené lekce",
      jeden: false,
      zaznamy: klient.hotoveLekce.map((l) => ({
        Kurz: l.lesson.course.title,
        Lekce: l.lesson.title,
        Dokončeno: cas(l.completedAt),
      })),
    },
    {
      nazev: "Hodnocení lekcí",
      jeden: false,
      zaznamy: klient.hodnoceniLekci.map((h) => ({
        Lekce: h.lesson.title,
        Hvězdičky: h.stars,
        Kdy: datum(h.updatedAt),
      })),
    },
    {
      nazev: "Kvízy",
      jeden: false,
      zaznamy: klient.pokusyKvizu.map((k) => ({
        Lekce: k.quiz.lesson.title,
        Správně: `${k.correct} z ${k.total}`,
        Splněno: k.passed,
        Kdy: cas(k.createdAt),
      })),
    },
    {
      nazev: "Certifikáty",
      jeden: false,
      zaznamy: klient.certifikaty.map((c) => ({
        Číslo: c.number,
        Kurz: c.courseTitle,
        "Jméno na certifikátu": c.clientName,
        Vydáno: datum(c.issuedAt),
      })),
    },
    {
      nazev: "Odznaky",
      jeden: false,
      zaznamy: klient.odznaky.map((o) => ({
        Odznak: POPIS_ODZNAKU[o.kind].nazev,
        Získáno: datum(o.awardedAt),
      })),
    },
    {
      nazev: "Aktivní týdny",
      jeden: false,
      zaznamy: klient.aktivniTydny.map((t) => ({ Týden: popisTydne(t.week) })),
    },
    {
      nazev: "Účast na webinářích",
      jeden: false,
      zaznamy: klient.ucastNaWebinarich.map((u) => ({
        Webinář: u.webinar.title,
        Termín: cas(u.webinar.startsAt),
      })),
    },
    {
      nazev: "Dotazy u lekcí",
      jeden: false,
      zaznamy: klient.dotazyKLekcim.map((d) => ({
        Lekce: d.lesson.title,
        Dotaz: d.text,
        Položen: cas(d.createdAt),
        Odpověď: d.answer,
        Zodpovězen: cas(d.answeredAt),
      })),
    },
    {
      nazev: "Konzultace",
      jeden: false,
      zaznamy: klient.rezervace.map((r) => ({
        Termín: cas(r.slot.startsAt),
        "Délka (minut)": r.slot.durationMinutes,
        Místo: r.slot.place,
        Rezervováno: cas(r.createdAt),
        Zrušeno: cas(r.cancelledAt),
        Zrušil: r.cancelledAt ? (r.cancelledByClient ? "vy" : "náš tým") : null,
      })),
    },
    {
      nazev: "Zprávy od nás",
      jeden: false,
      zaznamy: klient.zpravy.map((z) => ({
        Zpráva: z.text,
        Odesláno: cas(z.createdAt),
        Přečteno: cas(z.readAt),
      })),
    },
  ];

  if (doporuceni) {
    oddily.push({
      nazev: "Doporuč přítele",
      jeden: true,
      zaznamy: [
        {
          "Vaše kódy": doporuceni.kody.map((k) => k.kod).join(", ") || null,
          "Odměna (%)": doporuceni.procento,
          "Přivedení klienti": doporuceni.privedeno,
          "Vyplacené odměny": formatMoney(doporuceni.vyplaceno.castka, "CZK"),
          "Odměny čekající na výplatu": formatMoney(doporuceni.cekaNaVyplatu.castka, "CZK"),
        },
      ],
    });
  }

  return {
    vytvoreno: new Date(),
    spravce: { nazev: nastaveni.companyName, kontakt: nastaveni.contactEmail },
    oddily,
  };
}

/** Podoba pro JSON: české názvy, jednozáznamové oddíly jako objekt. */
export function mojeUdajeJakoJson(udaje: MojeUdaje): string {
  const obsah: Record<string, unknown> = {
    Vytvořeno: formatDatumCas(udaje.vytvoreno),
    Správce: udaje.spravce.nazev,
    "Kontakt na správce": udaje.spravce.kontakt,
  };
  for (const oddil of udaje.oddily) {
    obsah[oddil.nazev] = oddil.jeden ? (oddil.zaznamy[0] ?? null) : oddil.zaznamy;
  }
  return JSON.stringify(obsah, null, 2);
}

/**
 * Odpověď obou adres ke stažení (`/ucet/moje-udaje.json` a `.pdf`).
 * Obsluha adresy nemá rám klientské části, proto si přihlášení ověří sama
 * (`getKlient()` — bez přesměrování, 401). Stažení jde do auditu jen
 * s formátem.
 */
export async function odpovedMojichUdaju(format: "json" | "pdf"): Promise<Response> {
  const klient = await getKlient();
  if (!klient) return new Response("Nepřihlášeno.", { status: 401 });
  if (pricistStazeni(klient.accountId)) {
    return new Response("Údaje jste stahovali mnohokrát za sebou, zkuste to prosím za hodinu.", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const udaje = await nactiMojeUdaje(klient.clientId, klient.accountId);
  if (!udaje) return new Response("Nenalezeno.", { status: 404 });

  const telo =
    format === "json"
      ? new TextEncoder().encode(mojeUdajeJakoJson(udaje))
      : new Uint8Array(await vytvorPdfMojichUdaju(udaje));

  await zapisDoAuditu(db, {
    userId: null,
    entity: "clients",
    entityId: klient.clientId,
    action: "klient.ucet-export",
    after: { format },
  });

  return new Response(telo, {
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "application/pdf",
      "Content-Disposition": `attachment; filename="${nazevSouboru(format, udaje.vytvoreno)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Název souboru ke stažení: `moje-udaje-2026-10-21.json`. */
export function nazevSouboru(pripona: "json" | "pdf", kdy = new Date()): string {
  const den = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(kdy);
  return `moje-udaje-${den}.${pripona}`;
}
