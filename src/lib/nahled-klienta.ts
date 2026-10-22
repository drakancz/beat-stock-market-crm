import type { TagColor } from "@/generated/prisma/enums";
import { nactiCasovouOsu } from "@/lib/casova-osa";
import type { UdalostOsy } from "@/lib/casova-osa-druhy";
import { db } from "@/lib/db";
import { formatDatum, formatDatumCas, formatTelefon } from "@/lib/format";
import { stavUctu, type StavUctu } from "@/lib/klient/pozvanka";
import { aktualniHraniceNechodi, nechodi } from "@/lib/nechodi";
import { nactiPlatnostiKlienta, viditelniKlienti, viditelneObjednavky } from "@/lib/queries";
import type { Viewer } from "@/lib/session";
import { ORDER_STATUS_LABEL } from "@/lib/types";
import { nactiBodyKlientu } from "@/lib/vzdelavani/body";
import { isoTyden } from "@/lib/vzdelavani/odznaky";

/**
 * Rychlý náhled klienta ze seznamu (Fáze 5B, Jakub 18. 10. 2026).
 *
 * Vidí každý přihlášený, kdo vidí kartu klienta; **jen čtení** — měnit se
 * dál dá jen na kartě. Viditelnost je v dotazu (`viditelniKlienti()`),
 * smazaný klient se nenajde. Data jdou do prohlížeče už naformátovaná
 * v pražském čase, ať se tam nic nepřepočítává.
 */

/** Kolik posledních událostí z časové osy panel ukáže. */
export const UDALOSTI_V_NAHLEDU = 5;

export interface NahledKlienta {
  id: string;
  jmeno: string;
  email: string;
  telefon: string | null;
  stitky: { id: string; name: string; color: TagColor }[];
  pristup: "POVOLEN" | "NEPOVOLEN";
  souhlasMarketing: string | null;
  platnosti: { produkt: string; text: string; skoncilo: boolean }[];
  nechodi: boolean;
  klientskaCast: StavUctu;
  naposledy: string | null;
  aktivnichTydnu: number;
  lekciZa30Dni: number;
  /** Body a úroveň (5C, 18. 10. 2026), třeba „120 · Student“. */
  body: string;
  objednavky: { id: string; cislo: string; stav: string; kdy: string }[];
  pocetObjednavek: number;
  udalosti: UdalostOsy[];
}

export async function nactiNahledKlienta(
  viewer: Viewer,
  klientId: string,
): Promise<NahledKlienta | null> {
  const klient = await db.client.findFirst({
    where: { AND: [{ id: klientId }, viditelniKlienti(viewer)] },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      programAccess: true,
      consentMarketingAt: true,
      stitky: {
        where: { tag: { deletedAt: null } },
        orderBy: { tag: { name: "asc" } },
        select: { tag: { select: { id: true, name: true, color: true } } },
      },
      ucet: { select: { passwordHash: true, revokedAt: true, lastSeenAt: true } },
    },
  });
  if (!klient) return null;

  const ted = new Date();
  const objednavkyKlienta = { AND: [{ clientId: klient.id }, viditelneObjednavky(viewer)] };
  const [
    platnosti,
    objednavky,
    pocetObjednavek,
    posledniPlatba,
    aktivnichTydnu,
    lekciZa30Dni,
    { hranice },
    osa,
    body,
  ] = await Promise.all([
    nactiPlatnostiKlienta(viewer, klient.id),
    db.order.findMany({
      where: objednavkyKlienta,
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, number: true, status: true, createdAt: true },
    }),
    db.order.count({ where: objednavkyKlienta }),
    db.order.findFirst({
      where: { AND: [objednavkyKlienta, { status: "ZAPLACENO", paidAt: { not: null } }] },
      orderBy: { paidAt: "desc" },
      select: { paidAt: true },
    }),
    db.clientActiveWeek.count({
      where: {
        clientId: klient.id,
        week: {
          in: Array.from({ length: 12 }, (_, tydnu) =>
            isoTyden(new Date(ted.getTime() - tydnu * 7 * 86_400_000)),
          ),
        },
      },
    }),
    db.lessonProgress.count({
      where: {
        clientId: klient.id,
        completedAt: { gte: new Date(ted.getTime() - 30 * 86_400_000) },
      },
    }),
    aktualniHraniceNechodi(),
    // Stejná osa jako na kartě, i s pravidlem, že Změny vidí jen
    // administrátor — `nactiCasovouOsu()` je ostatním nevydá.
    nactiCasovouOsu(viewer, klient.id, { druh: null, pred: null }),
    nactiBodyKlientu([klient.id]),
  ]);
  const bodyKlienta = body.get(klient.id)!;

  return {
    id: klient.id,
    jmeno: klient.name,
    email: klient.email,
    telefon: klient.phone ? formatTelefon(klient.phone) : null,
    stitky: klient.stitky.map((odkaz) => odkaz.tag),
    pristup: klient.programAccess,
    souhlasMarketing: klient.consentMarketingAt ? formatDatum(klient.consentMarketingAt) : null,
    platnosti: platnosti.map((platnost) => ({
      produkt: platnost.produkt,
      text: platnost.skoncilo
        ? `skončilo ${formatDatum(platnost.do)}`
        : `do ${formatDatum(platnost.do)}`,
      skoncilo: platnost.skoncilo,
    })),
    nechodi: nechodi(
      {
        beziClenstvi: platnosti.some((platnost) => !platnost.skoncilo),
        posledniNavsteva: klient.ucet?.lastSeenAt ?? null,
        posledniPlatba: posledniPlatba?.paidAt ?? null,
      },
      hranice,
    ),
    klientskaCast: stavUctu(klient.ucet),
    naposledy: klient.ucet?.lastSeenAt ? formatDatumCas(klient.ucet.lastSeenAt) : null,
    aktivnichTydnu,
    lekciZa30Dni,
    body: `${bodyKlienta.body} · ${bodyKlienta.uroven.nazev}`,
    objednavky: objednavky.map((objednavka) => ({
      id: objednavka.id,
      cislo: objednavka.number,
      stav: ORDER_STATUS_LABEL[objednavka.status],
      kdy: formatDatum(objednavka.createdAt),
    })),
    pocetObjednavek,
    udalosti: osa.ok ? osa.udalosti.slice(0, UDALOSTI_V_NAHLEDU) : [],
  };
}
